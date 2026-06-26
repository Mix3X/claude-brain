// SessionStart hook: inject this project's recent memory as context.
// Fail-safe: any error -> emit empty output, never block the session.
import { readHook, projectName, withDeadline } from "./_lib.js";
import { recent } from "../src/store.js";
import { closePool } from "../src/db.js";
import { loadConfig } from "../src/config.js";

async function run() {
  const hook = await readHook();
  const project = projectName(hook);
  const { contextLimit } = loadConfig();
  const rows = await recent({ project, limit: contextLimit });
  if (!rows.length) return "";
  const lines = rows.map((r) => {
    const when = new Date(r.created_at).toISOString().slice(0, 10);
    return `- [${r.kind} ${when}] ${r.content.replace(/\s+/g, " ").slice(0, 280)}`;
  });
  return `## Mémoire partagée — projet "${project}" (${rows.length} entrées récentes)\n${lines.join("\n")}`;
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
