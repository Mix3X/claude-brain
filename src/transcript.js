import { readFileSync } from "node:fs";

// Parse a Claude Code transcript JSONL into structured pieces.
// Never throws: returns empty pieces on any read/parse error.
export function parseTranscript(path) {
  const prompts = [];
  const files = new Set();
  const tools = {};
  const assistantText = [];
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { prompts, files: [], tools, assistantText };
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const msg = ev.message;
    if (!msg) continue;
    if (ev.type === "user") {
      if (typeof msg.content === "string") prompts.push(msg.content);
      else if (Array.isArray(msg.content)) {
        for (const b of msg.content) if (b.type === "text") prompts.push(b.text);
      }
    } else if (ev.type === "assistant" && Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (b.type === "text" && b.text) assistantText.push(b.text);
        else if (b.type === "tool_use") {
          tools[b.name] = (tools[b.name] || 0) + 1;
          const fp = b.input?.file_path;
          if (fp) files.add(fp);
        }
      }
    }
  }
  return { prompts, files: [...files], tools, assistantText };
}
