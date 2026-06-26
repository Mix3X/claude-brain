// Stop hook: store a lightweight, LLM-free session summary built from the transcript.
// Extracts the opening request, files touched, and tools used. Fail-safe & instant.
import { readFileSync } from "node:fs";
import { readHook, projectName, withDeadline } from "./_lib.js";
import { addMemory } from "../src/store.js";
import { closePool } from "../src/db.js";

function parseTranscript(path) {
  const prompts = [];
  const files = new Set();
  const tools = {};
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { prompts, files: [], tools };
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const msg = ev.message;
    if (!msg) continue;
    if (ev.type === "user" && typeof msg.content === "string") {
      prompts.push(msg.content);
    } else if (ev.type === "user" && Array.isArray(msg.content)) {
      for (const b of msg.content) if (b.type === "text") prompts.push(b.text);
    } else if (ev.type === "assistant" && Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (b.type === "tool_use") {
          tools[b.name] = (tools[b.name] || 0) + 1;
          const fp = b.input?.file_path;
          if (fp) files.add(fp);
        }
      }
    }
  }
  return { prompts, files: [...files], tools };
}

async function run() {
  const hook = await readHook();
  const tp = hook.transcript_path;
  if (!tp) return;
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
    project: projectName(hook),
    kind: "summary",
    content,
    sessionId: hook.session_id || null,
    metadata: { files: files.slice(0, 50), tools, promptCount: prompts.length, auto: true },
    doEmbed: false,
  });
}

try {
  await withDeadline(run(), 6000);
} catch {
  /* never block */
}
await closePool().catch(() => {});
