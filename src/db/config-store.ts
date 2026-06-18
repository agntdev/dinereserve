import { getPool } from "../toolkit/index.js";
import {
  DEFAULT_RESTAURANT_CONFIG,
  type RestaurantConfig,
  type RestaurantTable,
} from "../config.js";

export async function getRestaurantConfig(): Promise<RestaurantConfig> {
  const pool = getPool();
  if (!pool) return DEFAULT_RESTAURANT_CONFIG;

  const config = { ...DEFAULT_RESTAURANT_CONFIG, tables: [] as RestaurantTable[] };

  try {
    const configResult = await pool.query<{ key: string; value: string }>(
      `SELECT key, value FROM configs WHERE key IN ('timezone', 'opening_hour', 'closing_hour', 'slot_interval_minutes')`,
    );
    for (const row of configResult.rows) {
      switch (row.key) {
        case "timezone":
          config.timezone = row.value;
          break;
        case "opening_hour": {
          const v = parseInt(row.value, 10);
          if (!isNaN(v)) config.openingHour = v;
          break;
        }
        case "closing_hour": {
          const v = parseInt(row.value, 10);
          if (!isNaN(v)) config.closingHour = v;
          break;
        }
        case "slot_interval_minutes": {
          const v = parseInt(row.value, 10);
          if (!isNaN(v) && v > 0) config.slotIntervalMinutes = v;
          break;
        }
      }
    }

    const tableResult = await pool.query<{ id: number; capacity: number }>(
      `SELECT id, capacity FROM restaurant_tables ORDER BY id`,
    );
    if (tableResult.rows.length > 0) {
      config.tables = tableResult.rows.map((r) => ({
        id: `t${r.id}`,
        capacity: r.capacity,
      }));
    }

    if (config.tables.length === 0) {
      config.tables = DEFAULT_RESTAURANT_CONFIG.tables;
    }
  } catch {
    return DEFAULT_RESTAURANT_CONFIG;
  }

  return config;
}
