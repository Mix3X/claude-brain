// UserPromptSubmit hook: store the user's prompt into shared memory.
// Instant (no embedding inline) and fail-safe. Output is empty -> session continues.
import { readHook, projectName, withDeadline } from "./_lib.js";
import { addMemory } from "../src/store.js";
import { closePool } from "../src/db.js";

// Skip inside the distiller's own headless Claude session (prevents recursion + noise).
if (process.env.BRAIN_INTERNAL === "1") process.exit(0);

async function run() {
  const hook = await readHook();
  const prompt = (hook.prompt || "").trim();
  if (!prompt) return;
  // skip trivial / slash-command-only prompts
  if (prompt.length < 3) return;
  await addMemory({
    project: projectName(hook),
    kind: "prompt",
    content: prompt,
    sessionId: hook.session_id || null,
    metadata: { source: hook.hook_event_name || "UserPromptSubmit" },
    doEmbed: false, // keep the hook instant; backfill embeddings later if enabled
  });
}

try {
  await withDeadline(run(), 5000);
} catch {
  /* never block */
}
await closePool().catch(() => {});
// no stdout -> Claude Code proceeds normally
