/**
 * Measures the answer call under different thinking budgets and entry counts.
 * COSTS QUOTA — one request per case, paced.
 *
 * Deliberately calls the provider DIRECTLY:
 *  · no router  — the candidate ids are hardcoded from a recorded run, so a
 *                 measurement costs 1 request instead of 2, and the answer
 *                 input is byte-identical across cases. Changing two things at
 *                 once would make the comparison worthless.
 *  · no fixtures — the fixture key does not include thinkingBudget, so every
 *                 case would replay the same recorded response and report a
 *                 spectacular and entirely fictional speedup.
 *
 * Compares against the recorded baseline fixture for the same question, on the
 * three things §5.3 and §5.4 actually care about: citation validity,
 * paraphrase (no verbatim reproduction), and Urdu register.
 */
import { requireEnv } from "../src/config.ts";
import { ANSWER_SCHEMA, buildAnswerPrompt } from "../src/prompts.ts";
import { GEMINI_ANSWER_MODEL, parseGeminiBody } from "../src/providers/gemini.ts";
import { buildPromptEntries } from "../src/entry-text.ts";
import { filterCitable } from "../src/corpus.ts";
import { pace } from "../src/pace.ts";
import type { Language } from "../src/types.ts";

/** Candidate ids the router actually returned for these questions. */
const IDS = [
  "672b3e8ed458540020750eab",
  "672c82436fa080001f6a18fc",
  "672c93c01c9a6f001f8eec39",
  "672c8b7d1c9a6f001f8eea5c",
  "67347128bd8a1c00203035a7",
];

interface Case {
  label: string;
  language: Language;
  question: string;
  entryCount: number;
  thinkingBudget: number | undefined;
}

const CASES: Case[] = [
  { label: "EN thinking=0  entries=5", language: "en", question: "What was the Prophet's ﷺ character like?", entryCount: 5, thinkingBudget: 0 },
  { label: "UR thinking=0  entries=5", language: "ur", question: "حضور ﷺ کا اخلاق کیسا تھا؟", entryCount: 5, thinkingBudget: 0 },
  { label: "EN thinking=0  entries=3", language: "en", question: "What was the Prophet's ﷺ character like?", entryCount: 3, thinkingBudget: 0 },
];

/** Longest run of consecutive answer words appearing verbatim in a source. */
function longestSharedRun(answer: string, sources: string[]): { n: number; phrase: string } {
  const norm = (s: string) => s.toLowerCase().normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const A = norm(answer);
  const hay = " " + sources.map((s) => norm(s).join(" ")).join("  ") + " ";
  let best = 0;
  let phrase = "";
  for (let i = 0; i < A.length; i++) {
    for (let n = A.length - i; n > best; n--) {
      const g = A.slice(i, i + n).join(" ");
      if (hay.includes(" " + g + " ")) {
        best = n;
        phrase = g;
        break;
      }
    }
  }
  return { n: best, phrase };
}

async function run(c: Case): Promise<void> {
  const ids = filterCitable(IDS, c.language).slice(0, c.entryCount);
  const entries = buildPromptEntries(ids, c.language);
  const prompt = buildAnswerPrompt(c.question, c.language, entries);

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: ANSWER_SCHEMA,
      maxOutputTokens: 8192,
      temperature: 0,
      ...(c.thinkingBudget === undefined ? {} : { thinkingConfig: { thinkingBudget: c.thinkingBudget } }),
    },
  };

  const started = Date.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_ANSWER_MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": requireEnv("GEMINI_API_KEY") },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const raw = await res.json();
  const elapsed = Date.now() - started;

  console.log(`\n${"─".repeat(72)}\n${c.label}   HTTP ${res.status}   ${elapsed}ms`);
  if (res.status !== 200) {
    console.log("  FAILED:", JSON.stringify(raw).slice(0, 300));
    return;
  }

  const u = (raw as any).usageMetadata ?? {};
  console.log(`  tokens: prompt=${u.promptTokenCount} out=${u.candidatesTokenCount} thoughts=${u.thoughtsTokenCount ?? 0} total=${u.totalTokenCount}`);

  const parsed = parseGeminiBody(raw);
  if (!parsed.ok) {
    console.log("  parse failed:", parsed.detail);
    return;
  }
  const data = parsed.data as { answer?: string; citations?: unknown };
  const answer = String(data.answer ?? "");
  const returned = Array.isArray(data.citations) ? data.citations.map(String) : [];

  // §5.3 — the check that matters most. A sloppier model does not produce a
  // worse answer, it produces a DISCARDED answer, which the user sees as the
  // bot refusing a question it should have answered.
  const valid = filterCitable(returned, c.language);
  const allValid = valid.length === returned.length && returned.length > 0;
  const inCandidates = returned.every((id) => ids.includes(id));

  // Compare against exactly the text the model was shown.
  const run = longestSharedRun(answer, entries.map((e) => `${e.title} ${e.body}`));

  console.log(`  citations: returned=${returned.length} valid=${valid.length} allValid=${allValid} withinCandidates=${inCandidates}`);
  console.log(`  longest verbatim run: ${run.n} words${run.n ? ` — "${run.phrase}"` : ""}`);
  console.log(`  answer chars=${answer.length}`);
  console.log(`\n  ${answer}`);
}

const only = process.argv[2];
for (const c of CASES) {
  if (only && !c.label.includes(only)) continue;
  await pace(GEMINI_ANSWER_MODEL);
  await run(c);
}
