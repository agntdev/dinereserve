import {
  DEFAULT_RESTAURANT_CONFIG,
  type RestaurantConfig,
  type Table,
} from "./config.js";

export interface TableAssignment {
  tables: Table[];
  leftoverSeats: number;
}

export function assignTables(
  partySize: number,
  occupiedTableIds: string[] = [],
  config: RestaurantConfig = DEFAULT_RESTAURANT_CONFIG
): TableAssignment | null {
  const freeTables = config.tables.filter(
    (table) => !occupiedTableIds.includes(table.id)
  );

  if (freeTables.length === 0 || partySize <= 0) {
    return null;
  }

  if (!config.allowTableSplitting) {
    const fit = [...freeTables]
      .sort((a, b) => a.seats - b.seats)
      .find((table) => table.seats >= partySize);

    if (!fit) {
      return null;
    }

    return { tables: [fit], leftoverSeats: fit.seats - partySize };
  }

  const singleOptions = freeTables
    .filter((table) => table.seats >= partySize)
    .sort((a, b) => a.seats - b.seats);

  if (singleOptions.length > 0) {
    const best = singleOptions[0];
    return { tables: [best], leftoverSeats: best.seats - partySize };
  }

  const sorted = [...freeTables].sort((a, b) => a.seats - b.seats);
  const assigned: Table[] = [];
  let remaining = partySize;

  for (const table of sorted) {
    if (remaining <= 0) {
      break;
    }
    if (table.seats <= remaining) {
      assigned.push(table);
      remaining -= table.seats;
    }
  }

  if (remaining > 0) {
    const extra = sorted.find(
      (table) => !assigned.includes(table) && table.seats >= remaining
    );
    if (!extra) {
      return null;
    }
    assigned.push(extra);
    remaining = 0;
  }

  const totalSeats = assigned.reduce((sum, table) => sum + table.seats, 0);
  return { tables: assigned, leftoverSeats: totalSeats - partySize };
}

export function formatTableAssignment(assignment: TableAssignment): string {
  return assignment.tables
    .map((table) => `${table.label ?? table.id} (${table.seats} seats)`)
    .join(", ");
}