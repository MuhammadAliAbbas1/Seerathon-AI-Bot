/**
 * Batch pacing. Measured, not guessed: gemini-2.5-flash returned 429 after 6
 * answer calls in ~31 s, which is an RPM ceiling rather than a daily one
 * (§5.6). A loop will hit it and burn the daily budget discovering that.
 *
 * A human asking questions at a demo will not — this is for scripts only.
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
