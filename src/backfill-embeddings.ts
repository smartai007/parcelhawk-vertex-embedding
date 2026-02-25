/**
 * Backfill script: read land_listings, embed the description field via Vertex AI,
 * and upsert into land_listing_embeddings. Run with: npm run backfill:ts
 *
 * Requires: DATABASE_URL, GOOGLE_CLOUD_PROJECT, GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON).
 */
import "dotenv/config";
import { existsSync } from "fs";
import { resolve } from "path";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import { registerTypes } from "pgvector/pg";
import { landListings, landListingEmbeddings } from "./db/schema.js";
import { getEmbedding } from "./embedding.js";

const BATCH_SIZE = 50;
const CONCURRENCY = 10; // parallel getEmbedding calls per batch (safe; 429s are retried)
const EMBEDDING_DIMENSIONS = 768;

function buildDescriptionText(description: string[] | null | undefined): string {
  if (!description || !Array.isArray(description) || description.length === 0) {
    return "";
  }
  return description.filter(Boolean).join("\n").trim();
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Missing DATABASE_URL in .env");
    process.exit(1);
  }

  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath || !keyPath.trim()) {
    console.error("Missing GOOGLE_APPLICATION_CREDENTIALS in .env");
    console.error("Add a line: GOOGLE_APPLICATION_CREDENTIALS=C:\\path\\to\\your-service-account-key.json");
    process.exit(1);
  }
  const absolutePath = resolve(keyPath.trim());
  if (!existsSync(absolutePath)) {
    console.error("Service account key file not found:", absolutePath);
    console.error("Set GOOGLE_APPLICATION_CREDENTIALS in .env to the full path of your JSON key file.");
    process.exit(1);
  }
  process.env.GOOGLE_APPLICATION_CREDENTIALS = absolutePath;

  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    console.error("Missing GOOGLE_CLOUD_PROJECT in .env");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await registerTypes(client);
  const db = drizzle(client);

  // Fail fast if Vertex AI credentials are missing
  try {
    await getEmbedding("test");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Could not load the default credentials") || msg.includes("default credentials")) {
      console.error("Vertex AI credentials not found. Do one of:");
      console.error("  1. Run: gcloud auth application-default login");
      console.error("  2. Or set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path in .env");
      console.error("See: https://cloud.google.com/docs/authentication/getting-started");
      await client.end();
      process.exit(1);
    }
    throw err;
  }

  let offset = 0;
  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalUpserted = 0;
  let totalFailed = 0;

  // Get total count up front for clearer progress logs
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(landListings);
  const totalCount = Number(count) || 0;

  console.log(
    `Starting backfill: land_listings -> land_listing_embeddings (Vertex AI, 768d). Total rows: ${totalCount}. Concurrency: ${CONCURRENCY}.`
  );

  while (true) {
    const batch = await db
      .select({ id: landListings.id, description: landListings.description })
      .from(landListings)
      .orderBy(landListings.id)
      .limit(BATCH_SIZE)
      .offset(offset);

    if (batch.length === 0) break;

    const rowsToEmbed = batch.filter((row) => buildDescriptionText(row.description).length > 0);
    totalSkipped += batch.length - rowsToEmbed.length;

    for (let i = 0; i < rowsToEmbed.length; i += CONCURRENCY) {
      const chunk = rowsToEmbed.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (row) => {
          const text = buildDescriptionText(row.description)!;
          try {
            const embedding = await getEmbedding(text);
            if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
              console.warn(`Wrong embedding length for listing ${row.id}, skipping.`);
              return "failed" as const;
            }
            await db
              .insert(landListingEmbeddings)
              .values({ listingId: row.id, embedding })
              .onConflictDoUpdate({
                target: landListingEmbeddings.listingId,
                set: { embedding, updatedAt: sql`now()` },
              });
            return "upserted" as const;
          } catch (err) {
            console.warn(`Failed listing ${row.id}:`, err);
            return "failed" as const;
          }
        })
      );
      totalUpserted += results.filter((r) => r === "upserted").length;
      totalFailed += results.filter((r) => r === "failed").length;
    }

    totalProcessed += batch.length;
    offset += batch.length;
    const percent =
      totalCount > 0 ? ((offset / totalCount) * 100).toFixed(1) : "100.0";
    console.log(
      `Processed ${offset}/${totalCount} rows (${percent}%) ` +
        `(upserted: ${totalUpserted}, skipped: ${totalSkipped}, failed: ${totalFailed}).`
    );

    if (batch.length < BATCH_SIZE) break;
  }

  console.log("Backfill done.", { totalProcessed, totalUpserted, totalSkipped, totalFailed });
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
