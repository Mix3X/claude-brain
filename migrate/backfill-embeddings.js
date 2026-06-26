// Backfill embeddings for rows that have none. Run anytime after enabling embeddings.
// Usage: node migrate/backfill-embeddings.js [batchSize]
import { getPool, closePool } from "../src/db.js";
import { embed, embeddingsEnabled } from "../src/embed.js";

if (!embeddingsEnabled()) {
  console.error("embeddings disabled (config.embed=false). Enable + install @huggingface/transformers first.");
  process.exit(1);
}

const batch = Number(process.argv[2]) || 200;
const pool = getPool();
let done = 0;

while (true) {
  const { rows } = await pool.query(
    `SELECT id, content FROM memories WHERE embedding IS NULL ORDER BY id LIMIT $1`,
    [batch]
  );
  if (!rows.length) break;
  for (const r of rows) {
    const vec = await embed(r.content);
    if (vec) await pool.query(`UPDATE memories SET embedding = $1 WHERE id = $2`, [vec, r.id]);
    done++;
  }
  console.log(`embedded ${done}...`);
}

console.log(`backfill complete: ${done} rows embedded.`);
await closePool();
