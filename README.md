# Parcel embedding backfill

Backfill script that reads `land_listings`, turns the `description` field into 768-d embeddings via Vertex AI (`text-embedding-005`), and upserts into `land_listing_embeddings`.

## Prerequisites

- Node 18+
- Postgres with **pgvector** (`CREATE EXTENSION vector;`)
- **Vertex AI** enabled and credentials (Application Default Credentials or `GOOGLE_APPLICATION_CREDENTIALS`)

## Setup

```bash
npm install
cp .env.example .env
# Edit .env: set DATABASE_URL and GOOGLE_CLOUD_PROJECT (and optionally GOOGLE_CLOUD_LOCATION)
```

## Run

```bash
npm run backfill:ts
```

Or build and run:

```bash
npm run build
npm run backfill
```

The script processes listings in batches of 50, skips rows with no description text, and upserts by `listing_id` (idempotent). Failed rows are logged and counted; rate limits are retried with backoff.
