import { readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

// Config lives outside the repo so it can hold the NAS password without being committed.
// Order: env var BRAIN_CONFIG > ~/.claude-brain/config.json
const DEFAULT_PATH = join(homedir(), ".claude-brain", "config.json");

let cached = null;

export function loadConfig() {
  if (cached) return cached;
  const path = process.env.BRAIN_CONFIG || DEFAULT_PATH;
  let raw = {};
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // fall through to env-only config; hooks must never crash on missing config
  }
  cached = {
    pg: process.env.BRAIN_PG || raw.pg || null,
    embed: process.env.BRAIN_EMBED === "1" ? true : Boolean(raw.embed),
    machine: process.env.BRAIN_MACHINE || raw.machine || hostname(),
    // how many memories SessionStart injects as context
    contextLimit: raw.contextLimit || 12,
  };
  return cached;
}
