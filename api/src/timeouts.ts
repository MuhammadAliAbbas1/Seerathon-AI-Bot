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

/**
 * Router (`gemini-2.5-flash-lite`). Measured 1.3–2.6s; this is ~3×.
 *
 * Trimmed 10s → 8s to hand the difference to the answer budget, which is the
 * one under pressure. The router has never once needed more than 2.6s, and it
 * does not think (see the answer budget note below), so its latency is stable
 * rather than input-dependent.
 */
export const ROUTER_TIMEOUT_MS = 8_000;

/**
 * Answer (`gemini-2.5-flash`, a thinking model).
 *
 * ⚠️ NOW ~10× HEADROOM, because the work shrank rather than the budget growing.
 * Same question, same 5 entries, on the deployment:
 *
 *     thinking on   answer elapsed=24831ms  out=277  thoughts=634
 *     thinking off  answer elapsed= 2163ms  out=258  thoughts=0
 *
 * Deliberately NOT trimmed to match. A budget that is never hit costs nothing,
 * and this file's own history is a caution against sizing a timeout tightly
 * from a handful of samples — that is exactly how 15s happened. Trim it only
 * once there is real distribution data, not three measurements.
 *
 * If it ever does need raising, the binding constraint is CLIENT_TIMEOUT_MS
 * below, which is baked into a shipped APK: past ~35s that costs a rebuild,
 * not a redeploy.
 */
export const ANSWER_TIMEOUT_MS = 30_000;

/**
 * Thinking budget for the ANSWER call, in tokens. 0 disables thinking.
 *
 * The answer call is not a reasoning task. By the time it runs, the router has
 * already decided mode, precedence, candidate entries and language; the answer
 * model receives up to five pre-selected, pre-validated entries and its job is
 * to synthesise and paraphrase them. That is composition, not deliberation.
 *
 * It was nonetheless spending MORE tokens thinking than writing — 634 thoughts
 * against 277 words of output — which is where 24.8 of the 27.4 seconds went.
 *
 * Note the router does not think at all (`gemini-2.5-flash-lite` defaults to
 * off; all 15 classify fixtures show `thoughtsTokenCount: 0`) and still makes
 * every judgment that matters, in 2.6s. The judgment half of this pipeline was
 * never the half that was thinking.
 */
export const ANSWER_THINKING_BUDGET = 0;

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
