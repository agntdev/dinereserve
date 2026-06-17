import type pg from "pg";
import {
  DEFAULT_RESTAURANT_CONFIG,
  type RestaurantConfig,
  type Table,
} from "./config.js";
import { getRepository } from "./db/index.js";
import type { RestaurantTableRow } from "./db/types.js";

export async function loadRestaurantConfig(
  pool: pg.Pool
): Promise<RestaurantConfig | null> {
  try {
    const repo = getRepository(pool);
    const configRow = await repo.configs.getLatest("restaurant.defaults");
    const tableRows = await repo.restaurantTables.list();

    if (!configRow && tableRows.length === 0) {
      return null;
    }

    const value = (configRow?.value ?? {}) as Record<string, unknown>;
    const tables: Table[] = tableRows.map((r: RestaurantTableRow) => ({
      id: r.id,
      seats: r.seats,
      label: r.label ?? undefined,
    }));

    return {
      openingHour:
        (value.openingHour as number) ?? DEFAULT_RESTAURANT_CONFIG.openingHour,
      openingMinute:
        (value.openingMinute as number) ??
        DEFAULT_RESTAURANT_CONFIG.openingMinute,
      closingHour:
        (value.closingHour as number) ?? DEFAULT_RESTAURANT_CONFIG.closingHour,
      closingMinute:
        (value.closingMinute as number) ??
        DEFAULT_RESTAURANT_CONFIG.closingMinute,
      sittingLengthMinutes:
        (value.sittingLengthMinutes as number) ??
        DEFAULT_RESTAURANT_CONFIG.sittingLengthMinutes,
      slotGranularityMinutes:
        (value.slotGranularityMinutes as number) ??
        DEFAULT_RESTAURANT_CONFIG.slotGranularityMinutes,
      allowTableSplitting:
        (value.allowTableSplitting as boolean) ??
        DEFAULT_RESTAURANT_CONFIG.allowTableSplitting,
      tables:
        tables.length > 0 ? tables : DEFAULT_RESTAURANT_CONFIG.tables,
    };
  } catch (error) {
    console.error("Failed to load restaurant config:", error);
    return null;
  }
}