export interface RestaurantTable {
  id: string;
  capacity: number;
}

export interface RestaurantConfig {
  timezone: string;
  openingHour: number;
  closingHour: number;
  tables: RestaurantTable[];
  slotIntervalMinutes: number;
}

export const DEFAULT_RESTAURANT_CONFIG: RestaurantConfig = {
  timezone: "UTC",
  openingHour: 11,
  closingHour: 22,
  tables: [
    { id: "t1", capacity: 2 },
    { id: "t2", capacity: 2 },
    { id: "t3", capacity: 4 },
    { id: "t4", capacity: 4 },
  ],
  slotIntervalMinutes: 30,
};
