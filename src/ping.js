// Connectivity + sanity check. Run: node src/ping.js
import { query, closePool } from "./db.js";
import { loadConfig } from "./config.js";

const cfg = loadConfig();
console.log("config:", { pg: cfg.pg ? cfg.pg.replace(/:[^:@/]+@/, ":****@") : null, embed: cfg.embed, machine: cfg.machine });

try {
  const v = await query("SELECT version()");
  console.log("connected:", v.rows[0].version.split(",")[0]);
  const ext = await query("SELECT 1 FROM pg_extension WHERE extname='vector'");
  console.log("pgvector:", ext.rowCount ? "installed" : "MISSING");
  const c = await query("SELECT count(*)::int n FROM memories");
  const byKind = await query("SELECT kind, count(*)::int n FROM memories GROUP BY kind ORDER BY n DESC");
  console.log("memories:", c.rows[0].n, "->", byKind.rows.map((r) => `${r.kind}:${r.n}`).join(" "));
  const proj = await query("SELECT count(*)::int n FROM projects");
  console.log("projects:", proj.rows[0].n);
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
