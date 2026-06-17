import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const moduleDir = dirname(fileURLToPath(import.meta.url));

export function loadSchemaSql(): string {
  return readFileSync(join(moduleDir, "../../db/schema.sql"), "utf8");
}

export async function migrate(databaseUrl?: string): Promise<void> {
  const connectionString = databaseUrl ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const client = new pg.Client({ connectionString });

  try {
    await client.connect();
    await client.query(loadSchemaSql());
  } finally {
    await client.end();
  }
}

export function createPool(databaseUrl?: string): pg.Pool {
  const connectionString = databaseUrl ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  return new pg.Pool({ connectionString });
}