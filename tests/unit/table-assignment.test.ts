import assert from "node:assert/strict";
import { DEFAULT_RESTAURANT_CONFIG } from "../../src/config.js";
import {
  assignTables,
  assignTablesGreedy,
  assignTablesWithOptions,
} from "../../src/tables.js";

function runTests(): void {
  const tables = DEFAULT_RESTAURANT_CONFIG.tables;

  const partyOfFour = assignTables(4);
  assert.ok(partyOfFour);
  assert.equal(partyOfFour.tables.length, 1);
  assert.equal(partyOfFour.tables[0].id, "t2");
  assert.equal(partyOfFour.leftoverSeats, 0);

  const partyOfEight = assignTables(8);
  assert.ok(partyOfEight);
  assert.equal(partyOfEight.tables.length, 3);
  assert.deepEqual(
    partyOfEight.tables.map((table) => table.id).sort(),
    ["t1", "t2", "t3"]
  );

  const partyOfNine = assignTables(9);
  assert.ok(partyOfNine);
  assert.equal(partyOfNine.tables.length, 3);
  assert.deepEqual(
    partyOfNine.tables.map((table) => table.id).sort(),
    ["t1", "t2", "t3"]
  );

  const occupied = assignTables(4, ["t2", "t3"]);
  assert.ok(occupied);
  assert.equal(occupied.tables[0].id, "t4");

  const noFit = assignTables(4, ["t1", "t2", "t3", "t4"]);
  assert.equal(noFit, null);

  const noSplitConfig = {
    ...DEFAULT_RESTAURANT_CONFIG,
    allowTableSplitting: false,
  };
  const splitDisabled = assignTablesWithOptions(5, {
    config: noSplitConfig,
  });
  assert.ok(splitDisabled);
  assert.equal(splitDisabled.tables[0].id, "t4");

  const splitDisabledFail = assignTablesWithOptions(7, {
    config: noSplitConfig,
  });
  assert.equal(splitDisabledFail, null);

  const greedy = assignTablesGreedy(3, tables, true);
  assert.ok(greedy);
  assert.equal(greedy.tables[0].id, "t2");

  console.log("table-assignment tests passed");
}

runTests();