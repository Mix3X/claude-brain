import pg from "pg";
import { loadConfig } from "./config.js";

let pool = null;

export function getPool() {
  if (pool) return pool;
  const { pg: conn } = loadConfig();
  if (!conn) throw new Error("claude-brain: no Postgres connection string (config.pg / BRAIN_PG)");
  pool = new pg.Pool({
    connectionString: conn,
    max: 4,
    // hooks are short-lived; fail fast instead of hanging the session
    connectionTimeoutMillis: 4000,
    idleTimeoutMillis: 5000,
  });
  pool.on("error", () => {}); // never let an idle-client error crash the process
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}

// Upsert project, return id.
export async function projectId(name) {
  const r = await query(
    `INSERT INTO projects (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name]
  );
  return r.rows[0].id;
}

export async function closePool() {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end().catch(() => {});
  }
}
