/**
 * Batch pacing for SCRIPTS ONLY. A human asking questions will not hit the
 * limit; a loop will, and it will burn the daily budget discovering that.
 *
 * The intervals below are measured rather than guessed — the answer model
 * rate-limits under burst, and the ceiling is per-minute rather than daily
 * (§5.6). The exact call count and window that trip it are deliberately not
 * recorded here: this repo is public and names the deployment's URL, so a
 * precise threshold would be a recipe for taking it offline. These intervals
 * are what the code needs; the raw measurement is in the private notes.
 */
export const PACE_MS = {
  "gemini-2.5-flash": 13_000,
  "gemini-2.5-flash-lite": 7_000,
} as const;

export function paceFor(model: string): number {
  return (PACE_MS as Record<string, number>)[model] ?? 13_000;
}

export async function pace(model: string, label = ""): Promise<void> {
  const ms = paceFor(model);
  process.stdout.write(`  …pacing ${ms / 1000}s before ${label || "next call"}\n`);
  await new Promise((r) => setTimeout(r, ms));
}
