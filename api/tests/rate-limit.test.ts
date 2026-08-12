import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";
import { __resetRateLimitForTests, checkRateLimit, clientIp } from "../src/rate-limit.ts";

/**
 * The limiter is the only thing between a public, unauthenticated endpoint and
 * our free-tier quota (§5.4). An untested limiter is worth roughly nothing:
 * the failure mode is silent — it either lets everything through or locks a
 * judge out mid-demo, and both look fine until they don't.
 */

describe("rate limit — per IP", () => {
  beforeEach(() => __resetRateLimitForTests());

  it("allows a normal burst of follow-up questions", () => {
    const t = 1_000_000;
    for (let i = 0; i < 10; i++) {
      assert.equal(checkRateLimit("1.1.1.1", t + i * 100).allowed, true, `request ${i + 1} should pass`);
    }
  });

  it("blocks the 11th request inside one minute", () => {
    const t = 1_000_000;
    for (let i = 0; i < 10; i++) checkRateLimit("1.1.1.1", t);
    const r = checkRateLimit("1.1.1.1", t);
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "per-ip-minute");
    assert.ok(r.retryAfterSeconds > 0 && r.retryAfterSeconds <= 60, "retryAfterSeconds must be usable");
  });

  it("recovers once the minute rolls over", () => {
    const t = 1_000_000;
    for (let i = 0; i < 10; i++) checkRateLimit("1.1.1.1", t);
    assert.equal(checkRateLimit("1.1.1.1", t).allowed, false);
    assert.equal(checkRateLimit("1.1.1.1", t + 60_001).allowed, true, "must not lock the caller out permanently");
  });

  it("one abusive IP does not affect another", () => {
    const t = 1_000_000;
    for (let i = 0; i < 15; i++) checkRateLimit("1.1.1.1", t);
    assert.equal(checkRateLimit("2.2.2.2", t).allowed, true);
  });

  it("enforces a daily ceiling per IP, paced under the per-minute limit", () => {
    let t = 1_000_000;
    let allowed = 0;
    // One request per minute for 150 minutes — never trips the burst limit,
    // so anything that stops it must be the daily counter.
    for (let i = 0; i < 150; i++) {
      if (checkRateLimit("3.3.3.3", t).allowed) allowed++;
      t += 61_000;
    }
    assert.equal(allowed, 100, "per-IP daily cap should bind at 100");
  });
});

describe("rate limit — global backstop", () => {
  beforeEach(() => __resetRateLimitForTests());

  it("caps total spend even when traffic is spread across many addresses", () => {
    // The per-IP limit is useless against this; the global counter is the
    // only thing that holds, which is why it exists.
    let t = 1_000_000;
    let allowed = 0;
    for (let i = 0; i < 700; i++) {
      if (checkRateLimit(`10.0.${Math.floor(i / 256)}.${i % 256}`, t).allowed) allowed++;
      t += 10;
    }
    assert.equal(allowed, 500, "global daily cap should bind at 500");
    const r = checkRateLimit("10.9.9.9", t);
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "global-day");
  });
});

describe("clientIp", () => {
  it("takes the leftmost entry of x-forwarded-for", () => {
    assert.equal(clientIp({ "x-forwarded-for": "203.0.113.5, 70.41.3.18" }), "203.0.113.5");
  });

  it("falls back to x-real-ip, then to a constant", () => {
    assert.equal(clientIp({ "x-real-ip": "198.51.100.7" }), "198.51.100.7");
    assert.equal(clientIp({}), "unknown");
  });

  it("handles a header delivered as an array", () => {
    assert.equal(clientIp({ "x-forwarded-for": ["203.0.113.9, 1.2.3.4"] }), "203.0.113.9");
  });

  it("groups unidentifiable callers together rather than exempting them", () => {
    // If a missing header produced a unique key, every anonymous caller would
    // get a fresh budget — the limiter would be trivially bypassable.
    __resetRateLimitForTests();
    const t = 1_000_000;
    for (let i = 0; i < 10; i++) checkRateLimit(clientIp({}), t);
    assert.equal(checkRateLimit(clientIp({}), t).allowed, false);
  });
});
