import { DEFAULT_RESTAURANT_CONFIG } from "../config.js";
import { createPool } from "./migrate.js";

export async function seedDefaultTables(databaseUrl?: string): Promise<void> {
  const pool = createPool(databaseUrl);

  try {
    for (const table of DEFAULT_RESTAURANT_CONFIG.tables) {
      await pool.query(
        `INSERT INTO restaurant_tables (id, seats, label)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE
         SET seats = EXCLUDED.seats, label = EXCLUDED.label`,
        [table.id, table.seats, table.label ?? null]
      );
    }

    await pool.query(
      `INSERT INTO configs (key, value)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (key, effective_from) DO NOTHING`,
      [
        "restaurant.defaults",
        JSON.stringify({
          openingHour: DEFAULT_RESTAURANT_CONFIG.openingHour,
          openingMinute: DEFAULT_RESTAURANT_CONFIG.openingMinute,
          closingHour: DEFAULT_RESTAURANT_CONFIG.closingHour,
          closingMinute: DEFAULT_RESTAURANT_CONFIG.closingMinute,
          sittingLengthMinutes: DEFAULT_RESTAURANT_CONFIG.sittingLengthMinutes,
          slotGranularityMinutes: DEFAULT_RESTAURANT_CONFIG.slotGranularityMinutes,
          allowTableSplitting: DEFAULT_RESTAURANT_CONFIG.allowTableSplitting,
        }),
      ]
    );
  } finally {
    await pool.end();
  }
}