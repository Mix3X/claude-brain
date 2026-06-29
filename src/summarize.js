// LLM session distiller. Spawned detached by the Stop hook.
// Reads the transcript, asks Claude to distill durable observations, stores them.
//
// Two backends, auto-selected:
//   - "cli" (default): runs `claude -p` headless, using your Claude Code subscription
//     auth (no API key, no extra cost). Set via config when anthropicApiKey is empty.
//   - "api": direct Anthropic Messages API (needs config.anthropicApiKey).
//
// Recursion guard: the CLI backend launches a real Claude session, which would re-fire
// the Stop hook -> another distiller -> infinite loop. We set BRAIN_INTERNAL=1 on that
// child; every brain hook no-ops when BRAIN_INTERNAL is set.
//
// Fully fail-safe: any error -> ~/.claude-brain/summarize.log, exit 0. No retries, no loops.
//
// CLI: node src/summarize.js <transcriptPath> <project> <sessionId>
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { parseTranscript } from "./transcript.js";
import { addMemory } from "./store.js";
import { closePool } from "./db.js";
import { loadConfig } from "./config.js";

const LOG = join(homedir(), ".claude-brain", "summarize.log");
function log(m) {
  try { appendFileSync(LOG, `[${new Date().toISOString()}] ${m}\n`); } catch {}
}

const [transcriptPath, project, sessionId] = process.argv.slice(2);

const INSTRUCTION =
  "Tu distilles une session de codage Claude Code en observations durables et réutilisables. " +
  "Garde seulement ce qui aide une session future: décisions, solutions, pièges, commandes, chemins, faits non triviaux. " +
  "Ignore le bavardage.\n\n" +
  "Réponds UNIQUEMENT avec un tableau JSON (aucun texte autour), 1 à 6 éléments:\n" +
  '[{"title":"...","type":"discovery|decision|fix|feature|gotcha|howto","narrative":"2-4 phrases","facts":["fait concret","commande","chemin"]}]';

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

function extractJsonArray(text) {
  if (!text) return null;
  let s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const a = s.indexOf("[");
  const b = s.lastIndexOf("]");
  if (a === -1 || b === -1 || b < a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

// --- backend: Claude Code CLI (subscription auth, no API key) ---
function callViaCli(cfg, context) {
  return new Promise((resolve, reject) => {
    const bin = cfg.claudePath || "claude";
    const args = ["-p", "--model", cfg.summarizeModel, "--output-format", "json"];
    const child = spawn(bin, args, {
      shell: true, // resolve claude.cmd / shim on Windows
      env: { ...process.env, BRAIN_INTERNAL: "1" }, // <- recursion guard
      stdio: ["pipe", "pipe", "ignore"],
    });
    let out = "";
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error("claude -p timeout")); }, 90000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => {
      clearTimeout(timer);
      // --output-format json wraps the answer: { type:'result', result:'<text>', ... }
      let resultText = out;
      try { const o = JSON.parse(out); if (o && typeof o.result === "string") resultText = o.result; } catch {}
      resolve(extractJsonArray(resultText) || []);
    });
    child.stdin.write(`${INSTRUCTION}\n\n---\nProjet: ${project}\n\n${context}`);
    child.stdin.end();
  });
}

// --- backend: Anthropic Messages API (needs API key) ---
async function callViaApi(cfg, context) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": cfg.anthropicApiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: cfg.summarizeModel,
      max_tokens: 1500,
      system: INSTRUCTION,
      messages: [{ role: "user", content: `Projet: ${project}\n\n${context}` }],
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return extractJsonArray(text) || [];
}

async function main() {
  if (!transcriptPath || !project) { log("missing args"); return; }
  const cfg = loadConfig();
  if (!cfg.summarize) { log("summarize disabled"); return; }
  const backend = cfg.anthropicApiKey ? "api" : "cli";

  const t = parseTranscript(transcriptPath);
  if (!t.prompts.some((p) => p && p.trim().length > 3)) { log("empty transcript, skip"); return; }

  const observations = backend === "api"
    ? await callViaApi(cfg, buildContext(t))
    : await callViaCli(cfg, buildContext(t));

  let stored = 0;
  for (const o of observations) {
    if (!o?.title) continue;
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
      metadata: { type: o.type || "discovery", auto_llm: true, backend, model: cfg.summarizeModel },
    });
    if (id) stored++;
  }
  log(`[${backend}] stored ${stored}/${observations.length} observations for ${project}`);
}

try {
  await main();
} catch (e) {
  log("ERROR: " + (e?.message || e));
} finally {
  await closePool().catch(() => {});
}
