/**
 * The timeout ladder. These four numbers are only correct RELATIVE to each
 * other, which is why they live together instead of at their use sites.
 *
 * The ordering that has to hold:
 *
 *   server worst case  <  client timeout  <  platform function limit
 *        ~33.5s        <       45s        <          60s
 *
 * Why each inequality matters:
 *
 * · server worst case < client timeout — so the app RECEIVES our typed 503
 *   instead of aborting first and rendering a generic network error. §5.6
 *   says a failure path may not lie about why it failed; a client that hangs
 *   up early turns an honest "the service is briefly at capacity" into an
 *   unexplained failure, which is the same defect one layer out.
 *
 * · client timeout < platform function limit — so the platform never kills
 *   the function mid-flight. A Vercel FUNCTION_INVOCATION_TIMEOUT is a bare
 *   504 with no body, so it reaches the app as an untyped error and loses the
 *   distinction between quota exhaustion and an outage.
 *
 * Worst case is derived, not guessed:
 *
 *   router call times out          15.0s
 *   blind retry sleep (§5.6)        1.5s
 *   router retry times out         15.0s
 *   ──────────────────────────────────────
 *                                  31.5s  → router fails → typed 503, and the
 *                                           answer call is never made.
 *
 * The other branch — a fast router then a doubly-timed-out answer call — is
 * ~2 + 31.5 = 33.5s. Both are comfortably inside 45s.
 *
 * Measured latencies for context (§5.6): router 1.3–2.3s. The 15s cap is
 * roughly 7× the observed router time, so it bounds a hang without cutting
 * off a slow-but-healthy call.
 */

/** Per provider HTTP call. Was 60s, which sat ABOVE the client timeout. */
export const PROVIDER_TIMEOUT_MS = 15_000;

/** Blind retry delay. Gemini documents no Retry-After and no retryDelay (§5.6). */
export const RETRY_DELAY_MS = 1_500;

/**
 * Client-side abort in mobile/src/api.ts. Duplicated as a comment rather than
 * imported because the app does not share a module graph with the server —
 * only contract.ts crosses that boundary (npm run contract:sync).
 */
export const CLIENT_TIMEOUT_MS = 45_000;

/**
 * Mirrors `functions["server.ts"].maxDuration` in vercel.json. Kept here so
 * the ladder is legible in one place; vercel.json is the value that binds.
 */
export const FUNCTION_MAX_DURATION_S = 60;
