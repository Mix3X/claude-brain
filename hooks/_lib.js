import { basename } from "node:path";

// Read full stdin and parse the Claude Code hook payload JSON. Never throws.
export async function readHook() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// claude-mem-compatible project name = basename of the working directory.
export function projectName(hook) {
  const cwd = hook.cwd || process.cwd();
  return basename(cwd.replace(/[\\/]+$/, "")) || "default";
}

// Hooks must NEVER block the session. Bound every hook by a hard deadline.
export function withDeadline(promise, ms = 6000) {
  return Promise.race([
    promise,
    new Promise((res) => setTimeout(res, ms).unref?.()),
  ]);
}
