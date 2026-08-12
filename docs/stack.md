# The stack, examined

Written 2026-08-12, at the end of Phase 4. This is meant to be read by an engineer who wants to know whether the choices here were reasoned or merely defaulted to. Where they were defaulted to, it says so.

I made these decisions, so treat the defensive passages with suspicion and the concessions as the more reliable half.

---

## 1. What we are actually running

**Not what Decision 1 said.** That decision recommended *Hono on Vercel*. We have neither. What exists today is:

- **Runtime:** Node 24, running `.ts` files directly via native type-stripping. No compile step, no bundler, no transpiler.
- **Framework:** **none.** Zero dependencies — `package.json` has an empty `dependencies` and an empty `devDependencies`.
- **HTTP layer:** `api/src/http.ts` exports one pure function, `handleAsk(body, provider) → { status, body }`. It knows nothing about HTTP transport; it takes a parsed body and returns a status and a serialisable object.
- **Dev server:** `api/scripts/dev-server.ts`, about 120 lines of `node:http`, wrapping that function. Defaults to fixtures so development spends no quota.
- **Tests:** `node --test`, built in.
- **Deployment:** **has not happened.** No `vercel.json`, no `.vercel`, no handler shim. Phase 3.5 is still ahead of us.

### When and why it changed

It did not change at a moment I can point to, and that is the problem. §9 of `CLAUDE.md` says *ask before adding dependencies*. Adopting Hono means adding one, so at the start of Phase 2 I wrote the core as a pure function instead — genuinely correct under §5.1's "headless core, thin surfaces" — and told myself the framework decision could come at deployment.

Then I never raised it. Phase 2, Phase 3 and Phase 4 all shipped around the gap. The framework question was deferred four times without once being surfaced for a decision.

The result is defensible — the core really is framework-agnostic, and that really is what §5.1 asks for. But the *process* was avoidance dressed as principle. A deferred decision that is never surfaced is not deferred, it is skipped, and it is now sitting in Phase 3.5 with less time around it than it would have had in Phase 2.

**Where that leaves us:** the pure-function core means any host can wrap it in a handful of lines, and swapping hosts is genuinely cheap. But "cheap" is a claim we have never tested, because the function has only ever been called by `node:http` on a laptop.

---

## 2. How a question actually flows

One question, `"حضور ﷺ کا اخلاق کیسا تھا؟"`, from keystroke to source card.

**The app** (`mobile/App.tsx`) holds a list of turns in React state. On submit it calls `ask()` in `mobile/src/api.ts`, which POSTs `{ question, language, history }` to `EXPO_PUBLIC_API_URL + /api/ask`. The app ships exactly one piece of config, that URL. No key ever enters the bundle, because an APK is trivially extractable (§5.4). The `language` field is a *hint* — the app's toggle — and the app is written to be overruled by the response.

**The HTTP shell** parses the body and hands it to `handleAsk()`. It rejects a missing question and one over 2,000 characters before either becomes a prompt. Everything else is the core's business.

**The core** (`api/src/ask.ts`) is where the pipeline lives:

1. **`route()`** (`router.ts`) runs *first*, before any answer generation. That ordering is architectural, not a prompt instruction (§5.2).
   - `detectLanguage()` sees Arabic script and returns `ur`; `answerLanguage()` maps that to the `ur` corpus block.
   - `rulingRatchet()` checks the one-way keyword list. A hit forces `ruling_seeking` and returns **without any model call**. A miss proves nothing and falls through.
   - The provider's `classify()` gets the question plus the **entire** routing index — all 154 entries, ~14k tokens. Nothing is excluded, so nothing can be missed. This is why it is not RAG.
   - The returned `mode` is validated **in code** against the three-value enum, because Gemini's `responseSchema` enum is explicitly not binding. Anything unexpected fails closed to `out_of_corpus`.
   - Candidate ids are filtered by §5.3 checks 1–3: exists, has a body, has one *in the answering language*.

2. **If the mode is not `in_corpus`**, we stop. The user gets fixed localized copy from `strings.ts` — no second request, no model involvement. Three of the four rubric behaviours never reach the answering model at all.

3. **`buildPromptEntries()`** (`entry-text.ts`) reads the full text of the selected entries from `corpus.json` — narration, lessons, hikayat — in the answering language only.

4. **`answer()`** on the provider sends those entries with an instruction to paraphrase and cite, never to quote. The model returns `{ answer, citations: [id] }`.

5. **`validateCitations()`** re-runs all three §5.3 checks on what the model *claims* it used. One bad id discards the entire answer — never repaired, never partially rendered. Then every field on every citation is read **from the cache**: id, type, title, text. The model contributed an id and nothing else.

**Back through the shell** as a 200 with `{ mode, language, answer, citations, disclaimer }`. `language` is authoritative — the app switches its own toggle to match if they disagree.

**The app renders** the bot bubble right-aligned with `writingDirection: rtl`, a citation chip beneath, and on tap a source card carrying the verbatim Urdu narration with a gold rule. The disclaimer bar sits pinned above the composer, non-dismissible.

### The boundaries that matter

- **`providers/` is the only code that knows a provider exists.** Two methods, `classify` and `answer`. Everything Gemini-specific — model ids, safety config, `finishReason` handling, 429 mapping — lives behind them.
- **`withFixtures()` wraps the provider**, not the HTTP client, which is why record/replay survives a provider swap.
- **`corpus.ts` is the only reader of `corpus.json`**, and it caches. Citation validation is an object lookup, not a fetch.
- **`strings.ts` is the only source of user-facing non-answer copy** — the server owns it, so the app cannot drift.

---

## 3. Why not Python and FastAPI

### The strongest case for it

Python is where AI engineering lives, and this is a hackathon judged by AI engineers. A judge opening a Python repo sees a familiar shape immediately; a judge opening a TypeScript repo with no framework has to be told why.

More concretely:

- **Pydantic would replace code we hand-wrote.** `isMode()`, `validateCitations()`, the `ProviderOutcome` union — all of that is bespoke validation we authored and tested ourselves. Pydantic does it declaratively, and it is battle-tested by a very large number of people. This is a real point and I do not have a good rebuttal beyond "ours is forty lines and has a hundred and eighteen tests around it."
- **Google's `google-genai` SDK is more idiomatic in Python**, and we are hand-rolling `fetch` calls against the REST API instead.
- **If we ever wanted evaluation tooling** — ragas, deepeval, promptfoo — the mature versions are Python.
- **Jupyter is a genuinely better prompt-iteration surface** than re-running a script.
- **If we ever needed embeddings, reranking, or clustering**, it would not be close.

### What it would cost, and why we did not

The deciding factor is narrow and, I think, decisive: **we do no machine learning whatsoever.**

It is worth being precise about what this backend actually does:

1. Reads a JSON file from disk at boot.
2. Concatenates strings into a prompt.
3. Makes at most two HTTPS POSTs.
4. Parses the JSON that comes back.
5. Looks up ids in a hash map and compares booleans.

There is no numpy, no vector arithmetic, no tokenizer, no model loading, no embeddings, no similarity search — because §4B ruled all of that out on the grounds that 154 entries fit in a prompt. Python's advantage is its *libraries*, and we use none of the ones that make it the right answer.

Against that, the costs are real:

- **A second language and toolchain** for a solo developer on a deadline, when the app is already TypeScript.
- **No shared types with the React Native client.** We would hand-write the contract twice with no compiler able to compare them. (We currently do this anyway — see §5. But TypeScript at least *could* fix it.)
- **Windows Python environment management** is more friction than `npm install`, and this project is on Windows.
- **Deployment**: a Python function on Vercel is heavier and slower to cold-start than a JS one, and cold start is on the demo path.

So: the strongest case for Python is that it is the conventional choice for AI work and that Pydantic is better than what we wrote. The case against is that our backend is an HTTP client with a hash map, and "conventional for AI work" describes a category we do not belong to.

---

## 4. Why not the others

**Next.js API routes.** Would have worked, and would have given us a web fallback surface for iOS judges nearly free. Rejected as a whole React SSR framework carried for one POST route. Partly evidence, partly taste — and given we still have no deployment, the "it just works on Vercel" argument has aged better than I gave it credit for.

**Express.** Genuinely fine. It is a dependency that buys routing and body parsing, and we have one route and twelve lines of body parsing. Nothing to regret, nothing gained.

**Go.** Excellent cold starts and a single deployable binary. But cold start turned out not to be the bottleneck — a routing call is 1.3–2.3s of inference, against which 300ms of cold start is noise — and Go shares no types with the RN client. Reasonable rejection on evidence.

**Deno.** Native TypeScript *with* type-checking, which is precisely the gap we have (§5). Honestly: rejected through unfamiliarity near a deadline, not through analysis. If I had spent an hour on it, it might have won.

**Bun.** Fast, native TS, good DX. Same admission — unfamiliar runtime, unknown behaviour on Vercel, avoided under time pressure. Taste and risk aversion, not evidence.

**Plain serverless functions.** This is very nearly what we built. `handleAsk()` *is* a serverless handler that has not met its platform yet. The distinction is mostly that we have not chosen the platform.

---

## 5. Where our choice is genuinely worse

Four things a knowledgeable judge could fairly push on. The first two were the ones I would have pushed on — **both are now closed**; the record of what they were is kept below, because a document that quietly deletes its own criticisms is not worth reading.

### 5.1 The API's TypeScript was never type-checked — **CLOSED 2026-08-12**

**The hole.** Node 24 runs `.ts` by **stripping** types, not checking them. There was no `typescript` dependency at the repo root and no `tsc` script, so every annotation in `api/src/` — including the router's, the citation validator's, and the provider union's — was a comment that looked like a guarantee. The mobile app was checked; the safety-critical half was not.

**Closed.** `typescript` and `@types/node` added as devDependencies (approved), plus a `tsconfig.json` matching how Node actually runs the code (`allowImportingTsExtensions`, `noEmit`) and a `typecheck` script.

**What the first-ever run found: 7 errors — and none of them in `api/src/`.** All seven were in `api/scripts/` and `api/tests/`, and all were `noUncheckedIndexedAccess` catching array indexing that TypeScript could not prove was populated (`bw[n]`, `r.citations[0]`, `.split("\n")[0]`).

That result is worth sitting with rather than celebrating. The good reading is that the production path is genuinely well-typed and 118 behavioural tests were doing real work. The honest reading is that **it proves nothing about how long the hole could have persisted** — the check found nothing in `api/src/` *this time*, on a codebase written in a few days by one author who happened to be careful. It would not have stayed that way, and the failure it prevents is silent: a field renamed on one side of a boundary, no test touching that exact path, and a runtime `undefined` on stage.

`npm run check` now runs contract-check, typecheck, and tests together.

### 5.2 The contract type was duplicated across the boundary — **CLOSED 2026-08-12**

**The hole.** `Mode` was declared in `api/src/types.ts` and again in `mobile/src/api.ts`. This was exactly the drift risk I named when recommending against a monorepo in Decision 3 — and then dismissed as "forty lines you will read every time." The mitigation I offered at the time, a single file copied by a script, was **not built for three phases** while I twice cited it as the reason the risk was acceptable.

**Closed.** `api/src/contract.ts` is now the single source of truth for the wire shape — `Mode`, `Language`, `Citation`, request and response bodies, error codes. `npm run contract:sync` copies it to `mobile/src/contract.ts` behind a generated-file banner; `npm run contract:check` fails if they have drifted and is the first step of `npm run check`. Both sides now import those types rather than redeclaring them.

Verified by deliberately adding a bogus fourth mode to the app copy and confirming `contract:check` failed, then restoring it — the guard was tested, not assumed.

**The general lesson, which outlives this specific fix:** when a decision is accepted *because* a mitigation is promised, the mitigation is part of the decision and not a follow-up. This one was cited as the reason no-monorepo was safe, and then not built until it was pointed out.

### 5.3 The dev server is not the production server

`node:http` is not Vercel's runtime, not Hono's, not anything we will ship. Body parsing, streaming, timeout semantics and cold-start behaviour will all differ. Everything we have verified end to end has been verified against a server that will not exist in production.

This is the direct cost of §1's deferred decision, and it is why Phase 3.5 now carries more risk than it should.

### 5.4 `node --test` on `.ts` files is a young path

It works, and it works with zero dependencies, which is a real win. But it is a recent capability, CI images vary in Node version, and the failure mode if a runner is on Node 20 is that nothing runs at all. Pinning `engines: node >= 20` is not enough — type-stripping needs 22.6+, and defaults-on needs 23+.

---

## 6. What would have changed the answer

The decision was reasoned rather than defaulted, but it was reasoned against *these* constraints. Change any of them and it flips:

- **If we did any real ML** — embeddings, a reranker, a local model, an eval harness over hundreds of cases — **Python, without hesitation.** This is the single biggest lever, and the fact that §4B ruled out RAG is what made TypeScript viable at all. Had we needed a vector store, this document would be about FastAPI.

- **If the client were not TypeScript.** Shared language with the RN app is a real advantage, and it evaporates if the frontend is Swift, Kotlin, or a web app someone else owns.

- **If throughput mattered.** At thousands of requests per second, Go's memory profile and cold starts would matter. At five requests per minute against a rate-limited free tier, they are irrelevant.

- **If the team were larger.** A framework's real value is that it encodes conventions so five people write the same shape of code. For one developer, "no framework" is coherent; for five, it is a liability.

- **If the deadline were further out.** Deno deserved an hour of evaluation it did not get, and it addresses our actual gap (§5.1) directly. That rejection was schedule pressure, not analysis.

- **If we had needed a web surface too.** Next.js would have won on the strength of getting `in_app` and `web` from one codebase — relevant here because submission is repo + APK, and an iOS judge cannot run our deliverable.

---

## The short version, for a judge

We are running **Node 24 with two devDependencies and zero runtime dependencies** — TypeScript and its Node types, both for checking only, neither shipped. The backend is a pure function that takes a question and returns structured JSON; the HTTP layer around it is about a hundred lines and is deliberately swappable. We chose TypeScript over Python because our backend does **no machine learning at all** — it is an HTTP client and a hash-map lookup — and because the client is React Native, so one language covers both halves.

~~The honest weakness that remains: **nothing has been deployed yet**~~ — **closed 2026-08-12.** The backend is live at `https://seerathon-api.vercel.app` on a captured `node:http` server, still with zero runtime dependencies. See the changelog below for what the deploy actually cost, because the estimate in this document was wrong in an instructive way.

---

## Changelog

This document is maintained, not archived. When something here stops being true, it gets amended and dated — a stack review that freezes as a snapshot of one afternoon is worse than none, because it is confidently wrong later.

- **2026-08-12 (written)** — Phase 4. Recorded the framework gap, the unchecked backend types, the duplicated contract, and the untested deployment path.
- **2026-08-12 (amended)** — §5.1 and §5.2 closed the same day: TypeScript added and the backend type-checked for the first time (7 errors, none in `api/src/`); `contract.ts` made the single source of truth with a sync-and-check script, drift detection verified by deliberately breaking it. §1's deployment gap is unchanged and remains the largest open risk.

- **2026-08-12 (amended)** — **§1's deployment gap closed.** Live at `https://seerathon-api.vercel.app`. Two things this document got wrong, both worth keeping:

  **The "no framework" verdict held, and was cheaper than argued.** The production entrypoint is ~110 lines of `node:http` wrapping the same `handleAsk()` the dev server uses. Vercel captures a root `server.ts` directly, so there was no adapter to write. Runtime dependencies remain **zero**. If anything this document *undersold* the position by treating it as a close call.

  **But "the production HTTP layer is still hypothetical" was the understatement.** The risk was not the HTTP layer — that was trivial. It was **four independent blockers, none of which were visible locally and every one of which would have shipped a broken deployment**: config read only `.env` (absent on any server, so every request would throw); `corpus.json` was loaded by a runtime-computed path the bundler cannot trace (not uploaded → `ENOENT` on the first question); `typescript@7` removed `ts.sys`, which Vercel's build-time typecheck calls, crashing the build; and the timeout ladder was inverted, so a hung provider would have reached the app as a generic network error instead of the typed 503 the server was about to send. **Deferring the deploy did not defer the risk — it concentrated it**, and the cost of finding these at judging rather than now is not comparable to the cost of finding them now.

  The general lesson, which is the one worth carrying: **"it works locally" and "it works deployed" are different claims about different systems**, and the gap between them is made of exactly the assumptions that never get stated — where config comes from, which files exist, what the toolchain runs. A stack review that says "not deployed yet" is describing an unknown, not a small remaining task.

  All four rubric behaviours are now verified *through* the deployment, along with the quota path — a real Gemini 429 became a typed 503 with calm copy in 0.65s, a behaviour previously only exercised offline.
