import {
  pgTable,
  bigserial,
  text,
  numeric,
  doublePrecision,
  varchar,
  integer,
  date,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { vector } from "drizzle-orm/pg-core";

export const landListings = pgTable("land_listings", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  url: text("url"),
  title: text("title"),
  price: numeric("price"),
  acres: numeric("acres"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  address1: text("address1"),
  address2: text("address2"),
  city: text("city"),
  stateAbbreviation: varchar("state_abbreviation", { length: 10 }),
  stateName: text("state_name"),
  zip: varchar("zip", { length: 20 }),
  county: text("county"),
  baths: integer("baths"),
  beds: integer("beds"),
  propertyType: text("property_type").array(),
  externalLink: text("external_link"),
  listingDate: date("listing_date"),
  description: text("description").array(),
  directions: text("directions").array(),
  activities: text("activities").array(),
  propertyAmenities: jsonb("property_amenities"),
  photos: text("photos").array(),
  propertyMediaData: jsonb("property_media_data"),
  brokerUrl: text("broker_url"),
  brokerContactName: text("broker_contact_name"),
  brokerEmail: text("broker_email"),
  brokerPhoneNumbers: jsonb("broker_phone_numbers"),
  brokerCompanyAddress1: text("broker_company_address1"),
  brokerCompanyAddress2: text("broker_company_address2"),
  brokerCompanyName: text("broker_company_name"),
  brokerCompanyCity: text("broker_company_city"),
  brokerCompanyState: varchar("broker_company_state", { length: 10 }),
  brokerCompanyZip: varchar("broker_company_zip", { length: 20 }),
  brokerDescription: text("broker_description").array(),
  brokerExternalLink: text("broker_external_link"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Embeddings for land listing descriptions (Vertex AI; 768 dimensions for text-embedding-005 / text-multilingual-embedding-002). */
export const landListingEmbeddings = pgTable(
  "land_listing_embeddings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    listingId: integer("listing_id")
      .notNull()
      .references(() => landListings.id, { onDelete: "cascade" })
      .unique(),
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("land_listing_embeddings_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
  ]
);
