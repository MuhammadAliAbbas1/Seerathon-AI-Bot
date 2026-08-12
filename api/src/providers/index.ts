import { providerId } from "../config.ts";
import { createGeminiProvider } from "./gemini.ts";
import { createOpenRouterProvider } from "./openrouter.ts";
import { withFixtures } from "./fixtures.ts";
import type { LlmProvider } from "./types.ts";

/**
 * Provider is chosen ONCE, here, from config — never branched on inside the
 * pipeline (§5.6). Anything downstream that asks "which provider is this?" is
 * a bug.
 *
 * There is deliberately NO automatic failover from Gemini to OpenRouter.
 * Silent mid-request provider switching would change refusal calibration, Urdu
 * quality and JSON adherence invisibly, and a demo that changes character
 * halfway through is worse than one that returns an honest 503. Quota
 * exhaustion surfaces as the typed 503 in §5.4. The switch is manual: change
 * LLM_PROVIDER, redeploy, verify.
 */
export function createProvider(id: string = providerId()): LlmProvider {
  switch (id) {
    case "gemini":
      return withFixtures(createGeminiProvider());
    case "openrouter":
      return withFixtures(createOpenRouterProvider());
    default:
      throw new Error(`Unknown LLM_PROVIDER "${id}" — expected "gemini" or "openrouter"`);
  }
}

export type { LlmProvider, ProviderOutcome } from "./types.ts";
