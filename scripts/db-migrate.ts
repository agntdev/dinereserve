import { migrate } from "../src/db/migrate.js";
import { seedDefaultTables } from "../src/db/seed.js";

const seed = process.argv.includes("--seed");

await migrate();
console.log("Database schema applied.");

if (seed) {
  await seedDefaultTables();
  console.log("Default tables and config seeded.");
}