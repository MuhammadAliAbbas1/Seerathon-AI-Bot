/**
 * The timeout ladder. These numbers are only correct RELATIVE to each other,
 * which is why they live together instead of at their use sites.
 *
 * ── The bug this file exists to prevent, which it caused once ─────────────
 *
 * The first version of this file had ONE timeout for both models, set to 15s,
 * and justified it in a comment as "roughly 7× the observed router time".
 * That reasoning was sound for the router and invalid for the answer model,
 * because the same constant governed both.
 *
 * `gemini-2.5-flash` is a THINKING model. Measured from fixture
 * `usageMetadata`: 89–836 thought tokens plus 88–330 output tokens per answer.
 * Generating 400–1,200 tokens puts a HEALTHY answer call in the 10–25s band,
 * so a 15s cap sat inside the normal range rather than above it. On
 * 2026-08-12 a real in-corpus question on the deployment took 34.8s to fail:
 * router 3.3s, then two 15s answer timeouts with a 1.5s retry between them.
 *
 * ⚠️ **Answer latency scales with the number of cited entries** (capped at
 * MAX_CANDIDATES = 5): more entries → longer prompt → more thinking → slower.
 * So the timeout failed PREFERENTIALLY ON WELL-COVERED QUESTIONS — the ones
 * the corpus serves best, which is exactly what the in-corpus demo chip asks.
 * A cap tuned on thin questions looks fine and breaks on the demo.
 *
 * **Any future tuning must be derived from the ANSWER path's worst case,
 * never the router's.** They differ by more than an order of magnitude.
 *
 * ── The ordering that has to hold ─────────────────────────────────────────
 *
 *   server worst case  <  client abort  <  platform function limit
 *        ~40s          <     45s        <         >=60s
 *
 * · server worst case < client abort — so the app RECEIVES our typed 503
 *   instead of aborting first and rendering a generic network error. §5.6
 *   says a failure path may not lie about why it failed; a client that hangs
 *   up early turns an honest, typed failure into an unexplained one.
 *
 * · client abort < platform limit — so the platform never kills the function
 *   mid-flight. A Vercel FUNCTION_INVOCATION_TIMEOUT is a bare 504 with no
 *   body, which loses the distinction between quota and outage entirely.
 *
 * ⚠️ **CLIENT_TIMEOUT_MS is baked into the shipped APK** (§6), so it cannot be
 * changed without a rebuild. It is therefore a FIXED CEILING that the server
 * budget must fit under — not a free variable to raise when the server needs
 * more room.
 *
 * Worst case, derived:
 *
 *   router times out                        10.0s
 *   answer times out (NO retry — see below) 30.0s
 *   ─────────────────────────────────────────────
 *                                           40.0s   < 45s ✓
 *
 * (Strictly, a transport failure on both calls adds two fast retries at ~2.5s
 * each, reaching ~45s. Transport failures fail fast by nature — refused
 * connection, DNS — so this is the pathological corner, and it is the one
 * case where the client aborting first costs nothing extra.)
 */

/** Router (`gemini-2.5-flash-lite`). Measured 1.3–2.6s; this is ~4×. */
export const ROUTER_TIMEOUT_MS = 10_000;

/**
 * Answer (`gemini-2.5-flash`, a thinking model).
 *
 * ⚠️ MEASURED ON THE DEPLOYMENT, 2026-08-12, on the in-corpus demo chip —
 * the question this budget exists to survive:
 *
 *     answer  elapsed=24831ms  budget=30000ms  tokens(prompt=2758 out=277 thoughts=634)
 *
 * **24.8s against a 30s budget is 83% consumed — 5.2s of headroom.** It
 * passes, and it is tighter than it should be. Two reasons to think the true
 * worst case is higher: recorded fixtures show answer prompts up to 4,051
 * tokens (this one was 2,758) and up to 836 thought tokens (this one 634).
 * A heavier question plausibly lands near 30s.
 *
 * The binding constraint on raising it is CLIENT_TIMEOUT_MS below, which is
 * baked into a shipped APK. Raising the answer budget past ~35s therefore
 * requires a rebuild, not just a redeploy.
 */
export const ANSWER_TIMEOUT_MS = 30_000;

/** Blind retry delay. Gemini documents no Retry-After and no retryDelay (§5.6). */
export const RETRY_DELAY_MS = 1_500;

/**
 * Client-side abort in mobile/src/api.ts. Duplicated as a constant rather than
 * imported because the app does not share a module graph with the server —
 * only contract.ts crosses that boundary (npm run contract:sync). Baked into
 * the APK at build time: changing it costs a ~10-minute rebuild.
 */
export const CLIENT_TIMEOUT_MS = 45_000;

/**
 * Platform ceiling. `vercel.json`'s `functions` property cannot configure a
 * captured root server (§5.7), so this is the platform default rather than a
 * value we set — >=60s on Hobby, and the docs report 300s with fluid compute.
 * We design against the conservative figure.
 */
export const FUNCTION_MAX_DURATION_S = 60;
