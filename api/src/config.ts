import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Where configuration is coming from. Decided ONCE, all-or-nothing.
 *
 * ⚠️  The two sources are NEVER merged, and that is the whole point.
 *
 * A stale GEMINI_API_KEY belonging to a different Google account and a
 * different project sits in the ambient shell environment on the dev machine
 * (§5.6). Anything that reads process.env as a per-key fallback silently
 * authenticates as the wrong account whenever a key is missing from .env —
 * this has already happened once and spent requests on the wrong project.
 *
 * So: if .env exists we are on the dev machine, and process.env is ignored
 * ENTIRELY — a key missing from .env is an error, never a quiet reach for the
 * ambient one. If .env does not exist we are deployed, where env vars are the
 * only mechanism and were set deliberately by us, so the stale-key hazard
 * cannot exist. Per-key fallback would reintroduce it; file-level selection
 * does not.
 *
 * If you are tempted to change this to `?? process.env[name]`, don't — that is
 * precisely the bug this shape exists to prevent.
 */
export type ConfigSource = "dotenv" | "environment";

let dotenvText: string | null | undefined;

/**
 * On a deployed host we do not merely PREFER environment variables — we refuse
 * to read a .env file at all, even if one is present on disk.
 *
 * .vercelignore excludes .env, but "a file we listed in an ignore file did not
 * get uploaded" is a weak guarantee to hang key separation on, and the build
 * output's filePathMap does mention .env. If a stray .env ever did reach the
 * bundle, the file-presence rule below would silently flip production onto the
 * DEV project's Gemini key while continuing to report success — a failure with
 * no symptom until the wrong quota runs out. Vercel always sets VERCEL=1, so
 * this makes that impossible rather than unlikely, and /api/health reports
 * which source won so it is checkable instead of assumed.
 */
const isDeployed = process.env.VERCEL === "1" || process.env.VERCEL === "true";

function readDotenv(): string | null {
  if (isDeployed) return null;
  if (dotenvText === undefined) {
    try {
      dotenvText = readFileSync(join(REPO_ROOT, ".env"), "utf8");
    } catch {
      dotenvText = null;
    }
  }
  return dotenvText;
}

/** Reported by /api/health so the active source is checkable, not assumed. */
export function configSource(): ConfigSource {
  return readDotenv() === null ? "environment" : "dotenv";
}

/**
 * Read one config value from whichever single source configSource() selected.
 *
 * Parsed with string operations rather than a regex: a heredoc-authored regex
 * silently ate a leading character from one of these keys once already.
 */
export function readEnv(name: string): string | undefined {
  const text = readDotenv();
  if (text === null) {
    // Deployed. No .env on disk, so there is no stale-key hazard to guard.
    const v = process.env[name];
    return v && v.length > 0 ? v : undefined;
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
  if (!v) {
    throw new Error(
      configSource() === "dotenv"
        ? `${name} is not set in .env (the ambient environment is deliberately ignored — see config.ts)`
        : `${name} is not set in the deployment environment (no .env present — see config.ts)`
    );
  }
  return v;
}

export interface KeyReport {
  present: boolean;
  length: number;
  /** First 8 hex of sha256(key). Compare, don't reconstruct. */
  fingerprint: string;
  /** API keys are printable ASCII with no whitespace. Catches a pasted newline. */
  wellFormed: boolean;
}

/**
 * A checkable description of a secret, without disclosing any of it.
 *
 * `"present"` was the previous answer and it only ever meant "non-empty",
 * which reassures without informing — an empty-string bug and a correct key
 * look identical, and so do the dev key and the demo key.
 *
 * ⚠️ Deliberately NOT first-6/last-4, which is the usual convention and is what
 * we use when reading keys in a terminal. **`/api/health` is public** — the
 * backend URL ships inside an APK and the repo goes public at submission — so
 * that convention would publish 10 characters of a live key to anyone who
 * asks. A truncated hash answers every question we actually have of it ("is
 * this the same key I have locally?", "did it arrive intact?") and answers
 * nothing else.
 */
export function describeKey(name: string): KeyReport {
  const v = readEnv(name);
  if (!v) return { present: false, length: 0, fingerprint: "", wellFormed: false };
  return {
    present: true,
    length: v.length,
    fingerprint: createHash("sha256").update(v, "utf8").digest("hex").slice(0, 8),
    wellFormed: /^[\x21-\x7e]+$/.test(v),
  };
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
