// LLM session distiller (Sonnet). Spawned detached by the Stop hook.
// Reads the transcript, asks Claude to distill durable observations, stores them.
// Fully fail-safe: any error is logged to ~/.claude-brain/summarize.log and the
// process exits 0. No retries, no loops, no persistent process.
//
// CLI: node src/summarize.js <transcriptPath> <project> <sessionId>
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseTranscript } from "./transcript.js";
import { addMemory } from "./store.js";
import { closePool } from "./db.js";
import { loadConfig } from "./config.js";

const LOG = join(homedir(), ".claude-brain", "summarize.log");
function log(m) {
  try { appendFileSync(LOG, `[${new Date().toISOString()}] ${m}\n`); } catch {}
}

const [transcriptPath, project, sessionId] = process.argv.slice(2);

const TOOL = {
  name: "record_observations",
  description: "Record durable, reusable observations distilled from a coding session.",
  input_schema: {
    type: "object",
    properties: {
      observations: {
        type: "array",
        description: "1 to 6 distinct, durable observations worth remembering across sessions.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short, specific title (one line)." },
            type: { type: "string", enum: ["discovery", "decision", "fix", "feature", "gotcha", "howto"] },
            narrative: { type: "string", description: "2-4 sentences: what was learned/done and why it matters." },
            facts: { type: "array", items: { type: "string" }, description: "Concrete reusable facts, commands, paths, gotchas." },
          },
          required: ["title", "narrative"],
        },
      },
    },
    required: ["observations"],
  },
};

function buildContext({ prompts, files, tools, assistantText }) {
  const parts = [];
  parts.push("## Demandes utilisateur\n" + prompts.slice(0, 12).map((p) => "- " + p.replace(/\s+/g, " ").slice(0, 400)).join("\n"));
  if (assistantText.length) {
    parts.push("## Extraits des réponses de l'assistant\n" + assistantText.slice(-8).map((t) => t.replace(/\s+/g, " ").slice(0, 600)).join("\n\n"));
  }
  if (files.length) parts.push("## Fichiers touchés\n" + files.slice(0, 40).join("\n"));
  const toolStr = Object.entries(tools).map(([k, v]) => `${k}×${v}`).join(", ");
  if (toolStr) parts.push("## Outils\n" + toolStr);
  return parts.join("\n\n").slice(0, 14000);
}

async function callClaude(cfg, context) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: cfg.summarizeModel,
      max_tokens: 1500,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "record_observations" },
      system:
        "Tu distilles une session de codage Claude Code en observations durables et réutilisables. " +
        "Garde seulement ce qui aide une session future: décisions, solutions, pièges, commandes, chemins, faits non triviaux. " +
        "Ignore le bavardage. Sois concret et spécifique. Réponds via l'outil record_observations.",
      messages: [
        { role: "user", content: `Projet: ${project}\n\n${context}` },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === "tool_use" && b.name === "record_observations");
  return block?.input?.observations || [];
}

async function main() {
  if (!transcriptPath || !project) { log("missing args"); return; }
  const cfg = loadConfig();
  if (!cfg.summarize || !cfg.anthropicApiKey) { log("summarize disabled or no key"); return; }

  const t = parseTranscript(transcriptPath);
  if (!t.prompts.some((p) => p && p.trim().length > 3)) { log("empty transcript, skip"); return; }

  const observations = await callClaude(cfg, buildContext(t));
  let stored = 0;
  for (const o of observations) {
    const content = [
      `# ${o.title}`,
      o.narrative || "",
      (o.facts || []).map((f) => `- ${f}`).join("\n"),
    ].filter(Boolean).join("\n");
    const id = await addMemory({
      project,
      kind: "observation",
      content,
      sessionId: sessionId || null,
      metadata: { type: o.type || "discovery", auto_llm: true, model: cfg.summarizeModel },
    });
    if (id) stored++;
  }
  log(`stored ${stored}/${observations.length} observations for ${project}`);
}

try {
  await main();
} catch (e) {
  log("ERROR: " + (e?.message || e));
} finally {
  await closePool().catch(() => {});
}
