// Apply sql/schema.sql to the configured Postgres. Idempotent (CREATE ... IF NOT EXISTS).
// Run from a PC once the NAS container is up: node src/setup.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { query, closePool } from "./db.js";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "..", "sql", "schema.sql"), "utf8");

try {
  await query(sql);
  const ext = await query("SELECT 1 FROM pg_extension WHERE extname='vector'");
  console.log("schema applied. pgvector:", ext.rowCount ? "installed" : "MISSING");
} catch (e) {
  console.error("setup failed:", e.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
