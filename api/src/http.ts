import { ask } from "./ask.ts";
import { DISCLAIMER } from "./strings.ts";
import type { LlmProvider } from "./providers/types.ts";
import type { Language } from "./types.ts";

/**
 * The HTTP shape of POST /api/ask (§5.4), as a pure function.
 *
 * Framework-agnostic on purpose (§5.1: headless core, thin surfaces). Hono,
 * a Vercel handler, or node:http can all wrap this in a few lines, and the
 * choice of framework is still open — adopting one is a dependency decision
 * (§9) that has not been made yet.
 */

export interface HttpResponse {
  status: number;
  body: unknown;
  /**
   * Server-side diagnostic for the log line. Deliberately a SIBLING of `body`
   * rather than a field inside it: it must never cross the wire. It names
   * which call failed, on which model, after how long, against what budget —
   * so the next incident explains itself instead of needing a reconstruction
   * from timing arithmetic.
   */
  diagnostic?: string;
}

const isLanguage = (v: unknown): v is Language => v === "en" || v === "ur";

export async function handleAsk(rawBody: unknown, provider: LlmProvider): Promise<HttpResponse> {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const question = typeof body.question === "string" ? body.question : "";

  if (!question.trim()) {
    return { status: 400, body: { error: { code: "invalid_request", message: "question is required" } } };
  }
  // Guard against a pathological payload before it becomes a prompt.
  if (question.length > 2000) {
    return { status: 400, body: { error: { code: "invalid_request", message: "question is too long" } } };
  }

  const result = await ask(question, {
    provider,
    languageHint: isLanguage(body.language) ? body.language : undefined,
    // Accepted from day one and deliberately ignored (§8). The field exists now
    // because adding it after the APK ships means a client change, a server
    // change and a rebuild; accepting it now costs nothing.
    history: body.history,
  });

  if (!result.ok) {
    // Failures are a different SHAPE, not a fourth mode (§5.4). `mode`
    // describes the question; quota and outages describe the system, and
    // conflating them would force every mode consumer to grow a branch that
    // has nothing to do with questions.
    return {
      status: 503,
      body: {
        error: {
          code: result.code,
          message: result.message,
          retryAfterSeconds: result.retryAfterSeconds,
        },
      },
      diagnostic: result.reason,
    };
  }

  return {
    status: 200,
    body: {
      mode: result.mode,
      // Authoritative. The client renders direction and font from this, not
      // from what it asked for.
      language: result.language,
      answer: result.answer,
      citations: result.citations,
      // Sent with every response so the surface cannot forget to show it. The
      // rubric requires it persistently visible and non-dismissible (§4).
      disclaimer: DISCLAIMER[result.language],
    },
  };
}
