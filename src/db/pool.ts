import type pg from "pg";
import { createPool } from "./migrate.js";

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool | null {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  if (!pool) {
    pool = createPool();
  }

  return pool;
}