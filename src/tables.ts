import {
  DEFAULT_RESTAURANT_CONFIG,
  type RestaurantConfig,
  type Table,
} from "./config.js";

export interface TableAssignment {
  tables: Table[];
  leftoverSeats: number;
}

export interface AssignTablesOptions {
  occupiedTableIds?: string[];
  config?: RestaurantConfig;
}

function sortBySeatsAsc(tables: Table[]): Table[] {
  return [...tables].sort((a, b) => a.seats - b.seats);
}

function assignmentScore(assignment: TableAssignment, partySize: number): number {
  const tablePenalty = assignment.tables.length * 100;
  return assignment.leftoverSeats + tablePenalty;
}

function buildAssignment(tables: Table[], partySize: number): TableAssignment {
  const totalSeats = tables.reduce((sum, table) => sum + table.seats, 0);
  return {
    tables,
    leftoverSeats: totalSeats - partySize,
  };
}

function assignSingleTable(
  partySize: number,
  freeTables: Table[]
): TableAssignment | null {
  const options = sortBySeatsAsc(freeTables).filter(
    (table) => table.seats >= partySize
  );

  if (options.length === 0) {
    return null;
  }

  return buildAssignment([options[0]], partySize);
}

function assignGreedyMultiTable(
  partySize: number,
  freeTables: Table[]
): TableAssignment | null {
  const sorted = sortBySeatsAsc(freeTables);
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
  }

  return buildAssignment(assigned, partySize);
}

export function assignTablesGreedy(
  partySize: number,
  freeTables: Table[],
  allowTableSplitting: boolean
): TableAssignment | null {
  if (partySize <= 0 || freeTables.length === 0) {
    return null;
  }

  if (!allowTableSplitting) {
    return assignSingleTable(partySize, freeTables);
  }

  const single = assignSingleTable(partySize, freeTables);
  const multi = assignGreedyMultiTable(partySize, freeTables);

  if (single && multi) {
    return assignmentScore(single, partySize) <= assignmentScore(multi, partySize)
      ? single
      : multi;
  }

  return single ?? multi;
}

export function assignTables(
  partySize: number,
  occupiedTableIds: string[] = [],
  config: RestaurantConfig = DEFAULT_RESTAURANT_CONFIG
): TableAssignment | null {
  const freeTables = config.tables.filter(
    (table) => !occupiedTableIds.includes(table.id)
  );

  return assignTablesGreedy(
    partySize,
    freeTables,
    config.allowTableSplitting
  );
}

export function assignTablesWithOptions(
  partySize: number,
  options: AssignTablesOptions = {}
): TableAssignment | null {
  const config = options.config ?? DEFAULT_RESTAURANT_CONFIG;
  return assignTables(partySize, options.occupiedTableIds ?? [], config);
}

export function formatTableAssignment(assignment: TableAssignment): string {
  return assignment.tables
    .map((table) => `${table.label ?? table.id} (${table.seats} seats)`)
    .join(", ");
}