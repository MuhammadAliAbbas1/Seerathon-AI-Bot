// Hermetic: pretend to be deployed so config reads process.env instead of the
// repo's .env, then supply a fake key. Both must be set BEFORE config.ts is
// first imported, because it decides its source once at module load — hence
// the dynamic import below rather than a top-level one.
process.env.VERCEL = "1";
process.env.GEMINI_API_KEY = "test-key-never-used-no-network-in-this-file";

import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";
import { ANSWER_TIMEOUT_MS, ROUTER_TIMEOUT_MS } from "../src/timeouts.ts";

const { createGeminiProvider } = await import("../src/providers/gemini.ts");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * Counts fetch attempts. The call COUNT is the whole behaviour under test —
 * the budget itself is asserted separately, off the failure detail, because
 * AbortSignal.timeout() does not expose its duration.
 */
function stubFetch(makeError: () => Error): { n: number } {
  const calls = { n: 0 };
  globalThis.fetch = (async () => {
    calls.n++;
    throw makeError();
  }) as typeof fetch;
  return calls;
}

const timeoutError = () => Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
const transportError = () => Object.assign(new Error("fetch failed"), { name: "TypeError" });

const req = { question: "x", language: "en" as const, index: "idx" };
const answerReq = { question: "x", language: "en" as const, entries: [{ id: "a", type: "shamail", title: "t", text: "b" }] as any };

describe("retry policy — transport yes, timeout never", () => {
  it("does NOT retry a timeout on the answer call", async () => {
    // Retrying grants the model the SAME budget that just proved insufficient,
    // so it fails identically — while Gemini still processes and bills the
    // abandoned request. On 2026-08-12 this turned an 18s failure into a 34.8s
    // one and spent two answer requests to return a single error.
    const calls = stubFetch(timeoutError);
    const out = await createGeminiProvider().answer(answerReq);
    assert.equal(calls.n, 1, "a timeout must cost exactly one request");
    assert.equal(out.ok, false);
    assert.equal(out.ok === false && out.failure, "timeout");
  });

  it("does NOT retry a timeout on the router call either", async () => {
    const calls = stubFetch(timeoutError);
    const out = await createGeminiProvider().classify(req);
    assert.equal(calls.n, 1);
    assert.equal(out.ok === false && out.failure, "timeout");
  });

  it("DOES retry a transport error exactly once", async () => {
    // A refused connection or dropped socket is a property of the moment, not
    // of the request, and fails fast — so a second attempt is cheap and often
    // succeeds.
    const calls = stubFetch(transportError);
    const out = await createGeminiProvider().classify(req);
    assert.equal(calls.n, 2, "transport failures get exactly one retry");
    assert.equal(out.ok === false && out.failure, "transport");
  });

  it("reports which op, model and budget failed, for the log line", async () => {
    stubFetch(timeoutError);
    const out = await createGeminiProvider().answer(answerReq);
    const detail = out.ok === false ? (out.detail ?? "") : "";
    assert.match(detail, /answer:timeout/, "names the op and the failure");
    assert.match(detail, /model=gemini-2\.5-flash/, "names the model");
    assert.match(detail, /budget=30000ms/, "names the budget it was given");
    assert.match(detail, /attempt=1/, "records that it did not retry");
  });
});

describe("the ladder itself", () => {
  it("gives the answer model materially more time than the router", () => {
    // The 2026-08-12 outage was caused by one shared constant sized from the
    // router's latency. These must never collapse back into a single number.
    assert.ok(
      ANSWER_TIMEOUT_MS >= 2 * ROUTER_TIMEOUT_MS,
      `answer budget ${ANSWER_TIMEOUT_MS}ms must be well above router ${ROUTER_TIMEOUT_MS}ms`
    );
  });

  it("keeps the server worst case under the client abort, which is baked into the APK", async () => {
    const { CLIENT_TIMEOUT_MS } = await import("../src/timeouts.ts");
    // The client cannot be raised without a ~10-minute rebuild, so it is a
    // fixed ceiling the server budget must fit under — not a free variable.
    assert.ok(
      ROUTER_TIMEOUT_MS + ANSWER_TIMEOUT_MS < CLIENT_TIMEOUT_MS,
      `server worst case ${ROUTER_TIMEOUT_MS + ANSWER_TIMEOUT_MS}ms must be under client ${CLIENT_TIMEOUT_MS}ms`
    );
  });
});
