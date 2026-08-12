/**
 * Client for POST /api/ask (§5.4).
 *
 * The ONLY config the app ships is the backend URL. No API key ever enters the
 * bundle — an APK is trivially extractable (§5.4).
 */
// Generated from api/src/contract.ts by npm run contract:sync.
// Redeclaring these here is what let Mode drift silently before.
export type { Citation, Language, Mode } from "./contract";
import type { Citation, Language, Mode } from "./contract";

export interface AskOk {
  kind: "ok";
  mode: Mode;
  language: Language;
  answer: string;
  citations: Citation[];
  disclaimer: string;
}

export interface AskErr {
  kind: "error";
  code: "quota_exhausted" | "provider_unavailable" | "network";
  language: Language;
  message: string;
  retryAfterSeconds: number;
}

export type AskResponse = AskOk | AskErr;

const BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787";

export async function ask(question: string, language?: Language): Promise<AskResponse> {
  try {
    const res = await fetch(`${BASE}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `history` is sent from day one even though the server ignores it, so
      // the wire shape never has to change after the APK ships (§5.4).
      body: JSON.stringify({ question, language, history: [] }),
      signal: AbortSignal.timeout(45_000),
    });
    const body = await res.json().catch(() => null);

    if (!res.ok || !body) {
      const err = body?.error;
      return {
        kind: "error",
        code: err?.code === "quota_exhausted" ? "quota_exhausted" : "provider_unavailable",
        language: (language ?? "en") as Language,
        message: err?.message ?? "",
        retryAfterSeconds: err?.retryAfterSeconds ?? 10,
      };
    }
    return { kind: "ok", ...body };
  } catch {
    return {
      kind: "error",
      code: "network",
      language: (language ?? "en") as Language,
      message: "",
      retryAfterSeconds: 5,
    };
  }
}
