import { getPool } from "../toolkit/index.js";

export async function persistSetup(setupTableCount: number): Promise<void> {
  const pool = getPool();
  if (!pool) {
    throw new Error("No DATABASE_URL set — cannot persist setup");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS configs (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS restaurant_tables (
      id INTEGER PRIMARY KEY,
      capacity INTEGER NOT NULL DEFAULT 4
    )
  `);

  await pool.query(
    `INSERT INTO configs (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    ["timezone", "UTC"]
  );
  await pool.query(
    `INSERT INTO configs (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    ["opening_hour", "11"]
  );
  await pool.query(
    `INSERT INTO configs (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    ["closing_hour", "22"]
  );
  await pool.query(
    `INSERT INTO configs (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    ["slot_interval_minutes", "30"]
  );

  for (let i = 1; i <= setupTableCount; i++) {
    await pool.query(
      `INSERT INTO restaurant_tables (id, capacity) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET capacity = EXCLUDED.capacity`,
      [i, 4]
    );
  }

  await pool.query(
    `DELETE FROM restaurant_tables WHERE id > $1`,
    [setupTableCount]
  );
}