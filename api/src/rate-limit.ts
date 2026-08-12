/**
 * IP rate limiting for POST /api/ask (§5.4 abuse mitigation).
 *
 * The endpoint is public and unauthenticated by design, and the repo — which
 * contains the backend URL — goes public at submission. So the URL is not a
 * secret and cannot be treated as one.
 *
 * ── What this actually buys, stated honestly ──────────────────────────────
 *
 * This is an in-process Map. It is per-instance, it resets on cold start, and
 * it is not shared between concurrently running instances. It therefore stops
 * the realistic case — one person or one script hammering the endpoint from a
 * single address — and does NOT stop a distributed attacker.
 *
 * That is a deliberate acceptance, not an oversight. Fixing it properly means
 * shared state (Redis/KV), which is a dependency and a service (§9) bought for
 * a threat model this project does not have. The REAL ceiling is the provider
 * quota: we are on Gemini's free tier, so the quota is the spend cap (§5.4) —
 * an attacker's reward for getting past this is exhausting a free allowance
 * and receiving typed 503s, not a bill.
 *
 * The global daily counter below is the part that matters most: it caps total
 * spend regardless of how many addresses the traffic arrives from, so it holds
 * even where the per-IP limit doesn't.
 */

/** Generous enough for a judge asking rapid follow-ups; tight enough to stop a loop. */
const PER_IP_PER_MINUTE = 10;
const PER_IP_PER_DAY = 100;

/**
 * Total across all callers. The backstop the per-IP limit cannot provide.
 * Sized well above a demo session and well below anything that would burn a
 * day of quota in one sitting.
 */
const GLOBAL_PER_DAY = 500;

const MINUTE = 60_000;
const DAY = 86_400_000;

interface Counter {
  minuteStart: number;
  minuteCount: number;
  dayStart: number;
  dayCount: number;
}

const perIp = new Map<string, Counter>();
const global: Counter = { minuteStart: 0, minuteCount: 0, dayStart: 0, dayCount: 0 };

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller could succeed. Surfaced as retryAfterSeconds. */
  retryAfterSeconds: number;
  /** Diagnostic only — logged, never shown to a user. */
  reason?: "per-ip-minute" | "per-ip-day" | "global-day";
}

function roll(c: Counter, now: number): void {
  if (now - c.minuteStart >= MINUTE) {
    c.minuteStart = now;
    c.minuteCount = 0;
  }
  if (now - c.dayStart >= DAY) {
    c.dayStart = now;
    c.dayCount = 0;
  }
}

/**
 * The caller's address, as reported by the platform's proxy.
 *
 * x-forwarded-for is client-controlled on a bare server, but on Vercel the
 * edge REWRITES it, so the leftmost entry is the real peer. This code is only
 * ever behind that proxy or on localhost, so trusting it is correct here — it
 * would not be if the process were ever exposed directly.
 */
export function clientIp(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers["x-forwarded-for"] ?? headers["x-real-ip"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return first?.split(",")[0]?.trim() || "unknown";
}

export function checkRateLimit(ip: string, now = Date.now()): RateLimitResult {
  roll(global, now);
  if (global.dayCount >= GLOBAL_PER_DAY) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((global.dayStart + DAY - now) / 1000),
      reason: "global-day",
    };
  }

  let c = perIp.get(ip);
  if (!c) {
    c = { minuteStart: now, minuteCount: 0, dayStart: now, dayCount: 0 };
    perIp.set(ip, c);
  }
  roll(c, now);

  if (c.minuteCount >= PER_IP_PER_MINUTE) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((c.minuteStart + MINUTE - now) / 1000),
      reason: "per-ip-minute",
    };
  }
  if (c.dayCount >= PER_IP_PER_DAY) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((c.dayStart + DAY - now) / 1000),
      reason: "per-ip-day",
    };
  }

  c.minuteCount++;
  c.dayCount++;
  global.minuteCount++;
  global.dayCount++;

  // Unbounded growth would be a slow leak on a long-lived instance. Entries
  // are tiny, so a lazy sweep at a high-water mark is enough.
  if (perIp.size > 10_000) {
    for (const [k, v] of perIp) {
      if (now - v.dayStart >= DAY) perIp.delete(k);
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test seam. */
export function __resetRateLimitForTests(): void {
  perIp.clear();
  global.minuteStart = 0;
  global.minuteCount = 0;
  global.dayStart = 0;
  global.dayCount = 0;
}
