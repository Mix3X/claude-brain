// SessionStart hook: inject a recap of this project's recent sessions + a clickable
// link to the brain web viewer.
// Fail-safe: any error -> emit empty output, never block the session.
import { readHook, projectName, withDeadline } from "./_lib.js";
import { query, closePool } from "../src/db.js";
import { loadConfig } from "../src/config.js";

// Skip entirely inside the distiller's own headless Claude session (prevents recursion).
if (process.env.BRAIN_INTERNAL === "1") process.exit(0);

// How many recent sessions to recap.
const SESSION_LIMIT = 6;

function fdate(ts) {
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}`;
}

// Clean a first-prompt into a short human title: strip slash-command wrappers,
// collapse whitespace, cap length.
function title(s) {
  if (!s) return "(session)";
  const t = s
    .replace(/<command-(name|message|args)>[\s\S]*?<\/command-(name|message|args)>/g, " ")
    .replace(/<\/?[a-z-]+>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (t || "(session)").slice(0, 90);
}

async function run() {
  const hook = await readHook();
  const project = projectName(hook);
  const cfg = loadConfig();

  // Recap: recent sessions for this project, newest first, with a title + activity counts.
  const r = await query(
    `SELECT m.session_id,
            min(m.created_at) started,
            count(*) FILTER (WHERE m.kind='prompt')::int prompts,
            count(*) FILTER (WHERE m.kind='observation')::int obs,
            count(*) FILTER (WHERE m.kind='summary')::int summ,
            (SELECT content FROM memories mm
               WHERE mm.session_id = m.session_id AND mm.kind='prompt'
               ORDER BY mm.created_at ASC LIMIT 1) first_prompt
     FROM memories m JOIN projects p ON p.id = m.project_id
     WHERE p.name = $1 AND m.session_id IS NOT NULL
     GROUP BY m.session_id
     ORDER BY started DESC
     LIMIT $2`,
    [project, SESSION_LIMIT]
  );

  // Viewer URL: explicit config wins, else derive from the Postgres host on :8787.
  const host = cfg.pgHost || "127.0.0.1";
  const viewer = cfg.viewerUrl || `http://${host}:8787`;

  if (!r.rows.length) {
    return `## 🧠 Brain — projet "${project}"\nAucune session passée.\n🔗 Visualiser le brain : ${viewer}`;
  }

  const lines = r.rows.map((s) => {
    const bits = [];
    if (s.prompts) bits.push(`${s.prompts} prompts`);
    if (s.obs) bits.push(`${s.obs} obs`);
    if (s.summ) bits.push(`${s.summ} résumés`);
    const meta = bits.length ? ` — ${bits.join(", ")}` : "";
    return `- **${fdate(s.started)}** · ${title(s.first_prompt)}${meta}`;
  });

  return [
    `## 🧠 Brain — projet "${project}" · ${r.rows.length} dernières sessions`,
    ...lines,
    `🔗 Visualiser le brain : ${viewer}`,
  ].join("\n");
}

let context = "";
try {
  context = (await withDeadline(run(), 6000)) || "";
} catch {
  context = "";
}
await closePool().catch(() => {});

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context,
    },
  })
);
