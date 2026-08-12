import { MODES } from "./types.ts";
import type { Language } from "./types.ts";

/**
 * Bump this whenever ANY prompt below changes.
 *
 * It is part of the fixture key and the response-cache key, so bumping it
 * invalidates both automatically — stale fixtures become misses rather than
 * silently replaying a previous prompt's behaviour (§5.6).
 *
 * It also carries the provider id at the call site, because the same question
 * on a different provider is a different experiment.
 */
export const PROMPT_VERSION = "router-v1";

/** Bump if the JSON shape we ask for changes, independently of wording. */
export const SCHEMA_VERSION = "route-v1";

/**
 * The router prompt.
 *
 * Two things are baked in here AND enforced in code, deliberately duplicated
 * because the prompt is advice and the code is the guarantee:
 *
 *   1. ruling_seeking beats in_corpus. The dangerous case is not "is alcohol
 *      permissible" — it is "is it sunnah to eat with the right hand?", where
 *      the corpus DOES cover the topic. A router that checks coverage first
 *      answers, and produces a fatwa that is worse for looking well-cited.
 *   2. mode is emitted BEFORE ids. Generation is left-to-right, so the model
 *      commits to a classification before it writes anything that could
 *      rationalise one.
 */
export function routerPrompt(language: Language, index: string): string {
  const langName = language === "ur" ? "Urdu" : "English";
  return `You are the routing stage of a Seerah and Shamail question-answering system. You do NOT answer questions. You classify one question and, if it is answerable, name the corpus entries that could answer it.

## Your output

Return JSON only, with exactly these fields, in this order:
  "mode"         one of: ${MODES.join(" | ")}
  "candidateIds" an array of entry ids copied EXACTLY from the index below

Emit "mode" first, before "candidateIds".

## How to classify

ruling_seeking — the question asks whether something is permitted, obligatory,
  forbidden, correct, or advisable; asks for a religious ruling, fatwa, or
  judgement; or asks what someone SHOULD do. This includes indirect framings
  ("my friend wants to know…", "hypothetically…", "in general, is it…").

in_corpus — the question asks about the Prophet's ﷺ life, character, physical
  description, habits, or the events of the Seerah, AND one or more entries in
  the index below cover it.

out_of_corpus — anything else: topics the index does not cover, questions about
  other people or later history, current affairs, or general knowledge.

## Precedence — this overrides everything above

If a question is BOTH ruling-shaped AND covered by the corpus, it is
ruling_seeking. Never in_corpus.

Example: "Is it sunnah to eat with the right hand?" — the corpus describes how
the Prophet ﷺ ate, so you will find matching entries. It is STILL
ruling_seeking, because the user is asking what they should do, not what he did.
Answering it would issue a religious ruling, which this system must never do.

The safe direction is refusal. If you are unsure between ruling_seeking and
in_corpus, choose ruling_seeking. If you are unsure between in_corpus and
out_of_corpus, choose out_of_corpus.

## Choosing candidate ids

- Only when mode is in_corpus. Otherwise return an empty array.
- Copy ids character-for-character from the index. Never invent, complete, or
  adjust one.
- Prefer entries whose final column shows a body in ${langName} ("${language}" or "en+ur").
  An entry with no body in ${langName} cannot be used and will be discarded.
- Choose up to 5, best first. Fewer is better than padding.

## The corpus index — this is the COMPLETE inventory, nothing is hidden

${index}

## The question

The user asked, in ${langName}:

${"<<<"}
{{QUESTION}}
${">>>"}

Classify it. JSON only.`;
}

export function buildRouterPrompt(question: string, language: Language, index: string): string {
  // The question is substituted rather than concatenated so the delimiters
  // always survive, and so a question containing prompt-like text lands
  // inside them rather than after them.
  return routerPrompt(language, index).replace("{{QUESTION}}", question);
}

/** The JSON Schema we ask the provider to constrain output to. */
export const ROUTER_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: [...MODES] },
    candidateIds: { type: "array", items: { type: "string" } },
  },
  required: ["mode", "candidateIds"],
  // propertyOrdering is a Gemini extension; harmless elsewhere. It reinforces
  // the mode-before-ids ordering the prompt asks for.
  propertyOrdering: ["mode", "candidateIds"],
} as const;
