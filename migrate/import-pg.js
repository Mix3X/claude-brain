// Import a JSONL export (from export-sqlite.py) into the NAS Postgres.
// Idempotent: re-running skips already-imported records (content_hash unique).
// Usage: node migrate/import-pg.js <export.jsonl> [--embed]
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { getPool, projectId, closePool } from "../src/db.js";
import { embed } from "../src/embed.js";
import { loadConfig } from "../src/config.js";

const file = process.argv[2];
const wantEmbed = process.argv.includes("--embed") || loadConfig().embed;
if (!file) {
  console.error("usage: node migrate/import-pg.js <export.jsonl> [--embed]");
  process.exit(1);
}

function hash(project, kind, content) {
  return createHash("sha256").update(`${project} ${kind} ${content}`).digest("hex");
}

const pool = getPool();
const projCache = new Map();
async function pid(name) {
  if (projCache.has(name)) return projCache.get(name);
  const id = await projectId(name);
  projCache.set(name, id);
  return id;
}

const { machine } = loadConfig();
let total = 0, inserted = 0, embedded = 0;

const rl = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
for await (const line of rl) {
  const s = line.trim();
  if (!s) continue;
  let rec;
  try { rec = JSON.parse(s); } catch { continue; }
  if (!rec.project || !rec.content) continue;
  total++;
  const project_id = await pid(rec.project);
  const ch = hash(rec.project, rec.kind, rec.content);
  let vec = null;
  if (wantEmbed) {
    vec = await embed(rec.content);
    if (vec) embedded++;
  }
  const r = await pool.query(
    `INSERT INTO memories (project_id, kind, session_id, machine, content, metadata, embedding, content_hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8, COALESCE($9::timestamptz, now()))
     ON CONFLICT (content_hash) WHERE content_hash IS NOT NULL DO NOTHING
     RETURNING id`,
    [project_id, rec.kind, rec.session_id || null, machine, rec.content,
     JSON.stringify(rec.metadata || {}), vec, ch, rec.created_at || null]
  );
  if (r.rowCount) inserted++;
  if (total % 250 === 0) console.log(`  ${total} read, ${inserted} new${wantEmbed ? `, ${embedded} embedded` : ""}...`);
}

console.log(`done: ${total} read, ${inserted} inserted, ${total - inserted} skipped (dupes)${wantEmbed ? `, ${embedded} embedded` : ""}`);
await closePool();
