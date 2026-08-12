import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, fixtureMode } from "../config.ts";
import { PROMPT_VERSION_BY_OP, SCHEMA_VERSION_BY_OP } from "../prompts.ts";
import type { AnswerRequest, ClassifyRequest, LlmProvider, ProviderOutcome } from "./types.ts";

export const FIXTURE_DIR = join(REPO_ROOT, "api", "fixtures");

/**
 * The prompt is part of the experiment, so it belongs in the key — along with
 * the provider and model, because the same question on a different model is a
 * different result (§5.6).
 *
 * Bumping PROMPT_VERSION therefore invalidates every affected fixture
 * automatically: they become misses, loudly, rather than silently replaying a
 * previous prompt's behaviour.
 */
export function fixtureKey(parts: {
  op: "classify" | "answer";
  provider: string;
  model: string;
  question: string;
  language: string;
}): string {
  // JSON-encoded rather than joined on a delimiter: the question is free text
  // and could contain any separator we picked, which would let two different
  // field splits hash identically. JSON.stringify is injective and printable
  // (a NUL separator here made git treat this file as binary).
  const material = JSON.stringify([
    parts.op,
    parts.provider,
    parts.model,
    PROMPT_VERSION_BY_OP[parts.op],
    SCHEMA_VERSION_BY_OP[parts.op],
    parts.language,
    parts.question.normalize("NFC").replace(/\s+/g, " ").trim(),
  ]);
  return createHash("sha256").update(material, "utf8").digest("hex").slice(0, 32);
}

interface FixtureFile {
  /** Human-readable so a directory listing is browsable. Not part of the key. */
  meta: {
    op: string;
    provider: string;
    model: string;
    promptVersion: string;
    schemaVersion: string;
    language: string;
    question: string;
    recordedAt: string;
  };
  outcome: ProviderOutcome;
}

export class MissingFixtureError extends Error {
  constructor(key: string, question: string) {
    super(
      `No fixture for "${question}" (key ${key}).\n` +
        `The offline suite must never fall through to a live call — that is how a\n` +
        `"free" test run quietly spends quota. To record it deliberately:\n` +
        `    FIXTURES=record in .env, then re-run.\n` +
        `If you just changed a prompt, PROMPT_VERSION invalidated this fixture on purpose.`
    );
    this.name = "MissingFixtureError";
  }
}

function pathFor(key: string): string {
  return join(FIXTURE_DIR, `${key}.json`);
}

export function readFixture(key: string): ProviderOutcome | null {
  const p = pathFor(key);
  if (!existsSync(p)) return null;
  return (JSON.parse(readFileSync(p, "utf8")) as FixtureFile).outcome;
}

export function writeFixture(key: string, file: FixtureFile): void {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(pathFor(key), JSON.stringify(file, null, 2) + "\n", "utf8");
}

/**
 * Wraps any provider in record/replay.
 *
 *   default (FIXTURES unset) — replay only. A miss throws MissingFixtureError.
 *                              It NEVER silently hits the network.
 *   FIXTURES=record          — hit live and write the fixture. Costs quota.
 *                              Opt-in, and never automatic.
 *
 * The entire raw envelope is stored, not just the text, so failure paths
 * (blocked, empty, truncated) are replayable too — those are the paths that
 * matter most and the ones you cannot conjure on demand from a live API.
 */
export function withFixtures(inner: LlmProvider, modeOverride?: "off" | "record"): LlmProvider {
  // The override exists so a deliberate recording script can turn recording on
  // for exactly one run, without leaving FIXTURES=record sitting in .env where
  // it would silently spend quota on the next ordinary test run.
  const mode = modeOverride ?? fixtureMode();

  const wrap = async (
    op: "classify" | "answer",
    model: string,
    question: string,
    language: string,
    run: () => Promise<ProviderOutcome>
  ): Promise<ProviderOutcome> => {
    const key = fixtureKey({ op, provider: inner.id, model, question, language });
    const existing = readFixture(key);
    if (existing) return existing;
    if (mode !== "record") throw new MissingFixtureError(key, question);

    const outcome = await run();

    // NEVER record a transient failure. A 429, a timeout or a dropped
    // connection is a property of the moment, not of the question — baking one
    // in would replay it forever and permanently poison that case. We learned
    // this the hard way: a Phase 3 batch exhausted RPM mid-run and wrote five
    // quota failures as though they were results.
    //
    // Blocked and malformed ARE recorded: those are reproducible model
    // behaviour and exactly the failure fixtures we want.
    if (!outcome.ok && (outcome.failure === "quota" || outcome.failure === "timeout" || outcome.failure === "transport")) {
      return outcome;
    }

    writeFixture(key, {
      meta: {
        op,
        provider: inner.id,
        model,
        promptVersion: PROMPT_VERSION_BY_OP[op],
        schemaVersion: SCHEMA_VERSION_BY_OP[op],
        language,
        question,
        recordedAt: new Date().toISOString(),
      },
      outcome,
    });
    return outcome;
  };

  return {
    id: `${inner.id}+fixtures`,
    classifyModel: inner.classifyModel,
    answerModel: inner.answerModel,
    classify: (req: ClassifyRequest) =>
      wrap("classify", inner.classifyModel, req.question, req.language, () => inner.classify(req)),
    answer: (req: AnswerRequest) =>
      wrap("answer", inner.answerModel, req.question, req.language, () => inner.answer(req)),
  };
}
