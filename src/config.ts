export interface Table {
  id: string;
  seats: number;
  label?: string;
}

export interface RestaurantConfig {
  openingHour: number;
  openingMinute: number;
  closingHour: number;
  closingMinute: number;
  sittingLengthMinutes: number;
  slotGranularityMinutes: number;
  allowTableSplitting: boolean;
  tables: Table[];
}

export const DEFAULT_RESTAURANT_CONFIG: RestaurantConfig = {
  openingHour: 11,
  openingMinute: 0,
  closingHour: 22,
  closingMinute: 0,
  sittingLengthMinutes: 90,
  slotGranularityMinutes: 15,
  allowTableSplitting: true,
  tables: [
    { id: "t1", seats: 2, label: "Table 1" },
    { id: "t2", seats: 4, label: "Table 2" },
    { id: "t3", seats: 4, label: "Table 3" },
    { id: "t4", seats: 6, label: "Table 4" },
  ],
};

export function totalSeatCapacity(config: RestaurantConfig): number {
  return config.tables.reduce((sum, table) => sum + table.seats, 0);
}