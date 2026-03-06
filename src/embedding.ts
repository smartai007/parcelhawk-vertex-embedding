/**
 * Vertex AI text embeddings (text-embedding-005, 768 dimensions).
 * Uses RETRIEVAL_DOCUMENT for description text.
 */
import * as aiplatform from "@google-cloud/aiplatform";
import { helpers } from "@google-cloud/aiplatform";

const EMBEDDING_DIMENSIONS = 768;
const TASK_TYPE = "RETRIEVAL_DOCUMENT";
const MODEL = "text-embedding-005";

let client: aiplatform.v1.PredictionServiceClient | null = null;

function getClient(): aiplatform.v1.PredictionServiceClient {
  if (!client) {
    client = new aiplatform.v1.PredictionServiceClient({
      apiEndpoint: process.env.GOOGLE_CLOUD_LOCATION
        ? `${process.env.GOOGLE_CLOUD_LOCATION}-aiplatform.googleapis.com`
        : "us-central1-aiplatform.googleapis.com",
    });
  }
  return client;
}

function getEndpoint(): string {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
  if (!project) {
    throw new Error("GOOGLE_CLOUD_PROJECT is required for embeddings.");
  }
  return `projects/${project}/locations/${location}/publishers/google/models/${MODEL}`;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get a single embedding for text. Retries on rate limit / transient errors.
 */

export async function getEmbedding(text: string): Promise<number[]> {
  const truncated = text.slice(0, 8000);
  const endpoint = getEndpoint();
  const predictionClient = getClient();
  const instances = [helpers.toValue({ content: truncated, task_type: TASK_TYPE })] as aiplatform.protos.google.cloud.aiplatform.v1.IValue[];
  const parameters = helpers.toValue({ outputDimensionality: EMBEDDING_DIMENSIONS });

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await predictionClient.predict({
        endpoint,
        instances,
        parameters,
      });
      const result = Array.isArray(response) ? response[0] : response;
      const predictions = (result as { predictions?: unknown[] }).predictions ?? [];
      if (predictions.length === 0) {
        throw new Error("No predictions returned");
      }
      type Pred = { structValue?: { fields?: { embeddings?: { structValue?: { fields?: { values?: { listValue?: { values?: { numberValue?: number }[] } } } } } } } };
      const p = predictions[0] as unknown as Pred;
      const values = p.structValue?.fields?.embeddings?.structValue?.fields?.values?.listValue?.values ?? [];
      const embedding = values.map((v) => v.numberValue ?? 0);
      if (embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`Unexpected embedding length: ${embedding.length}`);
      }
      return embedding;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable =
        msg.includes("429") ||
        msg.includes("RESOURCE_EXHAUSTED") ||
        msg.includes("UNAVAILABLE") ||
        msg.includes("DEADLINE_EXCEEDED");
      if (isRetryable && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
