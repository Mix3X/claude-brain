// Stop hook: store an instant heuristic session summary (always), then optionally
// spawn the LLM distiller (Sonnet) detached for rich observations. Fail-safe & instant.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readHook, projectName, withDeadline } from "./_lib.js";
import { parseTranscript } from "../src/transcript.js";
import { addMemory } from "../src/store.js";
import { closePool } from "../src/db.js";
import { loadConfig } from "../src/config.js";

const here = dirname(fileURLToPath(import.meta.url));

function spawnSummarizer(transcriptPath, project, sessionId) {
  try {
    const child = spawn(
      process.execPath,
      [join(here, "..", "src", "summarize.js"), transcriptPath, project, sessionId || ""],
      { detached: true, stdio: "ignore" }
    );
    child.unref(); // let it outlive this hook; it exits on its own after one API call
  } catch {
    /* spawning the distiller must never break session end */
  }
}

async function run() {
  const hook = await readHook();
  const tp = hook.transcript_path;
  if (!tp) return;
  const project = projectName(hook);
  const { prompts, files, tools } = parseTranscript(tp);
  const opening = prompts.find((p) => p && p.trim().length > 3);
  if (!opening) return;

  const toolStr = Object.entries(tools).map(([k, v]) => `${k}×${v}`).join(", ");
  const content = [
    `Requête: ${opening.replace(/\s+/g, " ").slice(0, 600)}`,
    files.length ? `Fichiers touchés: ${files.slice(0, 25).join(", ")}` : null,
    toolStr ? `Outils: ${toolStr}` : null,
    `Prompts: ${prompts.length}`,
  ].filter(Boolean).join("\n");

  await addMemory({
    project,
    kind: "summary",
    content,
    sessionId: hook.session_id || null,
    metadata: { files: files.slice(0, 50), tools, promptCount: prompts.length, auto: true },
    doEmbed: false,
  });

  // Rich LLM distillation (optional, detached, non-blocking).
  const cfg = loadConfig();
  if (cfg.summarize && cfg.anthropicApiKey) {
    spawnSummarizer(tp, project, hook.session_id || "");
  }
}

try {
  await withDeadline(run(), 6000);
} catch {
  /* never block */
}
await closePool().catch(() => {});
