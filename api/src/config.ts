import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Read a value from .env at the repo root.
 *
 * ⚠️  DELIBERATELY DOES NOT FALL BACK TO process.env.
 *
 * A stale GEMINI_API_KEY belonging to a different Google account and a
 * different project exists in the ambient shell environment (§5.6). Anything
 * that reads process.env first silently authenticates as the wrong account —
 * this has already happened once and spent requests on the wrong project.
 * If you are tempted to add `?? process.env[name]`, don't.
 *
 * Parsed with string operations rather than a regex: a heredoc-authored regex
 * silently ate a leading character from one of these keys once already.
 */
export function readEnv(name: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(join(REPO_ROOT, ".env"), "utf8");
  } catch {
    return undefined;
  }
  for (let line of text.split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() !== name) continue;
    let v = line.slice(eq + 1).trim();
    const quoted =
      v.length > 1 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")));
    if (quoted) v = v.slice(1, -1);
    return v || undefined;
  }
  return undefined;
}

export function requireEnv(name: string): string {
  const v = readEnv(name);
  if (!v) throw new Error(`${name} is not set in .env (ambient environment is deliberately ignored — see config.ts)`);
  return v;
}

/** gemini | openrouter. Switching providers is config, never a code change (§5.6). */
export function providerId(): string {
  return (readEnv("LLM_PROVIDER") || "gemini").toLowerCase();
}

/**
 * off      — never touch the network; a missing fixture is a loud failure
 * record   — hit the live API and write fixtures. COSTS QUOTA. Opt-in only.
 */
export function fixtureMode(): "off" | "record" {
  return readEnv("FIXTURES") === "record" ? "record" : "off";
}
