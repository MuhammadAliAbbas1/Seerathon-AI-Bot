# CLAUDE.md — Seerathon: Seerah Q&A Bot

Read this file at the start of every session before doing anything else.

---

## 1. What this project is

A hackathon submission for the **Seerathon**, role: `ai_bot` (Developers / AI Engineers).

We are building a **conversational Q&A bot about the Seerah and the Shamail** that is grounded *only* in an approved, fixed corpus provided by the organizers.

The full role brief is at `docs/Developers__AI_Engineer_Brief.pdf`. Read it once at the start of the project. This file is the working interpretation of it — where they conflict, the PDF wins and you should flag the conflict to me.

**Who is building this:** one developer (me), solo. You are doing the implementation. I own architecture decisions and review every change.

---

## 2. The single most important thing to understand

This is **not** primarily a "build a good chatbot" challenge. It is a **trust and safety** challenge wearing a chatbot's clothes.

The brief lists four required demo behaviours. Three of them are about the bot correctly *refusing* to answer:

| # | Behaviour | Required outcome |
|---|-----------|------------------|
| 1 | Question **inside** the corpus | Answer, with a citation to the exact source entry |
| 2 | Question **outside** the corpus | Graceful decline / safe fallback. Never guess. |
| 3 | **Ruling / fatwa-style** question | Refuse, and redirect the user to a human scholar (alim) |
| 4 | Disclaimer | Persistent, always visible, not dismissible |

The subject matter is religious. A hallucinated hadith or an invented detail about the Prophet ﷺ is not a bug — it is harm. A bot that answers "is X permissible?" is a machine issuing fatwas, which is exactly what the brief forbids.

**Therefore: correctness of refusal outranks quality of answer. Always. If you are ever choosing between the two, choose refusal.**

---

## 3. Core rules (from the brief, non-negotiable)

- Bot answers **only** from the approved corpus
- **No free-form religious rulings** under any circumstances
- **Always cite the source entry**
- **Always show the disclaimer**

---

## 4. The corpus

Base URL: `https://api.islamicdesk.com/api/seerathon/corpus`

**Confirmed working in Phase 0. No auth required** — anonymous GETs return 200. Full raw responses and evidence in `recon/`; the writeup is `recon/README.md`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/meta` | Counts, version, disclaimer text, usage rules |
| GET | `/shamail` | Shamail list (paginated) |
| GET | `/shamail/:id` | One Shamail entry |
| GET | `/timeline` | Seerah timeline list (paginated, plain text) |
| GET | `/timeline/:id` | One timeline entry |
| GET | `/courses` | Course titles index only |

Query params: `page`, `limit` (max 120), `q` (search text), `category_id` (Shamail only), `section` (Timeline only), `include_hikayat=true` (Shamail only, longer text).

### API gotchas — all verified in Phase 0

Each of these will cost an afternoon if rediscovered by debugging.

- **Never send an `Authorization` header.** No auth is required, but a global middleware rejects *any* `Authorization` header with **403 `"Token Unauthorized!"`** — including `Bearer` with a valid-looking value. Adding one reflexively (a shared fetch wrapper, a copied snippet) breaks every corpus call. `X-Api-Key` is ignored harmlessly.
- **Errors return HTTP 200.** A missing or malformed id returns `200` with `{"error": true, "data": null, "msg": "Shamail not found"}`. **Branch on `body.error`, never on `res.status`** — `res.ok` is true for every failure this API produces.
- **Ids are 24-char hex strings** (`"672b3e8ed458540020750eab"`), not integers. **Slugs are NOT unique** — 150 distinct slugs across 154 entries (`blessed-childhood` appears twice). **Cite by `id` only.** Anything keyed on slug will silently collide.
- **CORS is wide open** — `Access-Control-Allow-Origin: *`, preflight 204. Browser-origin calls work. We still proxy the LLM call server-side per §5.4, but that is about protecting *our* key, not theirs.
- **`q=` is unusable for retrieval.** It is a case-insensitive *literal substring* match — not tokenised (`"revenge blasphemy"` → 0 hits even though both words appear in one entry), no fuzzy matching — over a **partial field set**: `title`, `hadeesTarjama`, `keywords[]`, and timeline `content[].title`. It does **not** search `points[]` or timeline `content_text`, which is where most of the prose lives. Do not build any retrieval path on it. We hold the corpus ourselves and never call `q=` at query time.
- Response envelope: lists return `data.items[]`, single entries return **`data.item`** (singular). `limit` caps at 120 and clamps silently above that. Rate limit 60 req/min/IP — irrelevant at runtime since we bake, but the sync script must stay under it. It needs 3 requests.

### Two critical constraints

**A. Answer corpus = Shamail + Timeline ONLY.**
`/courses` is index/reference only. We may say "this topic is covered in course X" as a pointer. We may **never** answer *from* course content. Courses are a signpost, not a source.

**B. The corpus is small in entry count, but not as small in tokens as first assumed.**

**Real counts: 120 Shamail + 34 Timeline = 154 entries.** (Not ~50 timeline — that was a guess, and timeline entries are far longer than expected: nested `content[]` arrays of prose, not the "plain text" the brief implies.) Courses: 20, index only.

**All 154 are usable — but only because we bake `hikayat`.** Phase 0 found entry `67824f4d53748aebf74997ab` ("The blessed tongue of the Prophet Muhammad ﷺ") had titles in both languages and no body text in either. Phase 1 measured the full bake and found why: `hadeesTarjama` is on 113/120 and `points[]` on 50/120 (both exactly as Phase 0 reported), but **`hikayat` is on 120/120 in both languages** — and it gives that entry 3,384 chars of English body and 3,899 of Urdu.

So `include_hikayat=true` is not merely an answer-quality lever (§5.6); it is what makes the corpus **100% usable in both languages**. Baking without it would silently reintroduce a citable-but-groundless entry. This does not retire §5.3 check 2 — `hasBody` is computed per language from whatever was actually baked, so the check still catches a future corpus version that drops content.

Token cost, measured in Phase 0 (rough estimates, ±25%, and calibrated on a different tokenizer than Gemini's — treat as orders of magnitude, not budgets):

| Configuration | Est. tokens | Against Gemini's 250K TPM |
|---------------|-------------|---------------------------|
| English only, no hikayat | **~46k** | ✅ comfortably |
| Urdu only, no hikayat | ~76k | ✅ |
| Bilingual, no hikayat | **~122k** | ✅ — but ~half the minute's entire token budget, for one question |
| Bilingual + `include_hikayat` | **~280k** | ❌ **exceeds TPM outright** |

The constraint moved when we moved providers. Gemini 2.5 Flash's context window is not the limit — **the 250K TPM rate limit is** (§5.6). Whole-corpus-per-prompt is technically possible for the English slice and self-defeating for anything larger: one bilingual question would consume half a minute's tokens, and the full-fidelity corpus cannot be sent at all.

**This still does NOT mean build RAG.** No vector database, no embeddings, no chunking strategy, no similarity thresholds. That machinery solves "my corpus is too big to reason about at all." Ours is 154 entries — small enough that *every entry's identity fits in a single prompt*. Instead, two stages:

**Stage 1 — route.** A **bilingual routing index** over all 154 entries, one line each:

```
id | source | category/section | en.title | ur.title | keywords
```

Measured: **33,738 chars ≈ 9,700 tokens** for the complete corpus. Every entry is visible to the model at once. It returns candidate ids.

**Stage 2 — answer.** Send the **full text of only the selected ids**, then validate the returned citations against the cached corpus per §5.3.

To be explicit, because this looks superficially like retrieval: **this is not RAG.** There is no vector database, no embedding model, no chunking, no similarity threshold, no top-k tuning, nothing approximate. Stage 1 is the *entire* corpus index in the prompt; selection is the model reading a complete list, not a nearest-neighbour search over a lossy projection of it. Nothing can be missed because nothing was ever excluded from consideration.

**Bake everything to disk; be selective about what enters the prompt.** `corpus.json` gets the full 781 KB — both language blocks, `hikayat` included, every field. Disk and repo size are free; a build-time artifact costs nothing at runtime and means a late decision ("actually we do want hikayat for this") needs no re-sync and no network. **Context is the scarce resource, not storage.** The prompt gets the routing index plus the selected entries, and nothing else.

### Disclaimer text — the decision is BOTH

The `/meta` disclaimer string is **written at the bot builder, not at the end user**:

> *"Answers must come only from this corpus. Cite every answer with source id and title. Do not invent Hadith, Quran, or Seerah text. Refuse fatwa/ruling questions and redirect to an alim."*

That is an instruction sheet. Rendered as the persistent in-chat disclaimer it reads as a **leaked system prompt** — which undercuts exactly the trust the rubric is measuring. But the organizers wrote it and will look for it, and `usage_rules[5]` explicitly requires "Show a persistent disclaimer."

**So do both:**

1. **A short, human, user-facing disclaimer**, persistently visible in the chat surface and never dismissible. Written for a person asking a question. Localized (§7.1).
2. **The verbatim `/meta` string, both `en` and `ur`**, on an About / Corpus Rules screen **one tap away** from the chat. Reproduced exactly — **do not paraphrase, reword, reformat, or "improve" it.** That is the copy the organizers will search for.

Both are required. Neither substitutes for the other.

---

## 5. Architecture

### 5.1 Headless core, thin surfaces

The bot core is a **plain HTTP endpoint** that takes a question and returns structured JSON. Every user-facing surface is a thin adapter on top of it.

```
question in  →  [ core ]  →  { answer, citations[], mode, language }  →  surface adapter
```

This is deliberate: ~80% of the real work lives in the core and is completely independent of whether the output lands in a web page, a phone-framed widget, or a WhatsApp message. It also means we can add a second surface late and cheaply.

### 5.2 The pipeline

```
User question
      ↓
Guardrail router  ← classify BEFORE answering
      ↓
      ├── in_corpus      → retrieve → answer → VALIDATE CITATIONS → render with source card
      ├── out_of_corpus  → safe fallback, no guessing
      └── ruling_seeking → refuse, redirect to an alim
```

The router runs **first**, before any answer generation. This ordering is the design. Do not restructure it so that answering happens first and gets filtered afterwards.

#### Fail-closed IS the guarantee, not a backup

Gemini's `responseSchema` **does not enforce compliance** — the docs support an `enum` but state the model "is not guaranteed to strictly comply… always validate values in your application" (§5.6). We therefore have **no API-level guarantee** that `mode` comes back as one of our three values.

That promotes the fail-closed path from a safety net to **the actual mechanism**. In code, after every router call:

```
mode ∈ { in_corpus, out_of_corpus, ruling_seeking } ?  → proceed
anything else                                        → out_of_corpus
```

"Anything else" is not hypothetical. It includes an off-enum string, a missing field, malformed JSON, **empty `candidates`** (Gemini does not return blocked content), `finishReason: SAFETY`, `finishReason: MAX_TOKENS` truncating the JSON mid-object, a 429, and a network timeout. Every one of those lands on `out_of_corpus` — the safe fallback — and **never throws**, because an unhandled exception on stage is indistinguishable from a crash.

**Required test, and it is not optional:** feed the router layer a malformed and an off-enum response and assert it returns `out_of_corpus` rather than throwing. This path is now load-bearing and **an untested fallback path fails on stage** — which is the only place it will ever be exercised under pressure. Fixtures (§5.6) make this cheap: record one real response, hand-edit copies into the broken shapes, replay offline forever.

### 5.3 Citation validation (the key safety mechanism)

The model returns JSON: `{ answer, citations: [entry_id, ...] }`.

Then, **in code, not in the prompt**, every returned `entry_id` must pass **all three** checks. Phase 0 showed that "the id exists" is not sufficient.

**Check 1 — the id exists** in the cached corpus. Exact match against a hex-string key. Catches an outright invented citation.

**Check 2 — the entry has body text.** *Existence is not content.* A model that cites a title-only entry has, in practice, answered from its own knowledge and attached a decorative reference — the exact failure mode this section exists to prevent. Coverage is genuinely patchy per field: `hadeesTarjama` is on only **113 of 120** shamail entries and `points[]` on only **50 of 120**; entry `67824f4d53748aebf74997ab` has neither. It is only rescued because we bake `hikayat` (120/120), which is a build-time choice that could change.

Do **not** implement this as a hardcoded blocklist of known-empty ids. Read the `hasBody.{en,ur}` flags that `corpus:sync` computes from the bake — they stay correct when the corpus, or our bake options, change.

**Check 3 — the body exists in the language being answered in.** Coverage is *not* symmetric between `en` and `ur` — e.g. `hadeesHawala` is present on 112/120 in English but 119/120 in Urdu, and one entry has Urdu-only content. Citing an entry whose text exists only in the other language produces a source card the user cannot read, and an answer that cannot be checked against its own citation.

Any check failing on **any** citation, or **zero citations returned** → discard the answer entirely and fall through to the safe fallback. Never repair, never partially render, never show the answer with the bad citation stripped out — a wrong answer with the evidence removed is worse than no answer.

This is still deterministic, still ~40 lines, and still means a hallucinated or hollow citation cannot reach the user's screen. **Hard requirement, not an optimization.** Never trust the model's self-reported citations.

### 5.4 Secrets and the backend boundary

**No LLM API key ever enters the app bundle.** An APK is trivially extractable. The app ships with exactly one piece of config — the backend URL — and nothing else.

```
App  →  our backend (holds the key)  →  Gemini API (Google AI Studio)
                                     →  baked corpus.json
```

**Provider: Google Gemini via AI Studio.** Models — `gemini-2.5-flash-lite` routes, `gemini-2.5-flash` answers (both stable). **Do not put `gemini-3-flash-preview` on the demo path** — preview models can change under us. See §5.6 for the adapter, quota strategy, and the Gemini failure modes we must handle.

All guardrail logic, routing, and citation validation live server-side. A modified client must not be able to bypass them.

**Corpus is baked at build time, not fetched at runtime.** A `npm run corpus:sync` script pulls the full corpus from `api.islamicdesk.com` and writes `corpus.json` into the repo; the server imports it as a static object. This removes runtime latency, makes citation validation an object lookup, and — critically — means we still work if the organizers' API goes down during judging.

**Endpoint contract** — one route, `POST /api/ask`:

```jsonc
// request
{
  "question": "...",
  "language": "en"              // en | ur — the client's hint; the server may override
                                // it from detected question language (§7.1)
}

// response
{
  "mode": "in_corpus",          // in_corpus | out_of_corpus | ruling_seeking
  "language": "en",             // en | ur — the language THIS response is written in.
                                // Authoritative. The client renders direction and
                                // font from this, not from what it asked for.
  "answer": "...",
  "citations": [
    {
      "id": "672b3e8ed458540020750eab",   // 24-char hex string, NEVER an integer
      "type": "shamail",                  // shamail | timeline
      "title": "Sayyid al-Mursalin ﷺ never took personal revenge",
      "text": "..."                       // body text, in `language` above
    }
  ]
}
```

Every field on a citation is read from the **cached corpus after validation**, never copied from the model's output — the model supplies an id and nothing else. `title` and `text` come from the same language block as `language`, so a source card can never mix scripts.

**Design rule: the model never generates corpus text.** The `answer` is always the model's **own words** — framing, connecting, summarising. Verbatim corpus material (hadith translations, hawala references, timeline prose) is **only ever read from the cache and rendered in the source card**, never produced by the model. This is deliberate and does double duty:

1. **It is the rubric shape.** "Answer, with a citation to the exact source entry" is answer *plus* citation — a bot that simply regurgitates the passage has not answered, it has quoted.
2. **It avoids Gemini's `recitation` block.** `recitation` is a documented generation-block reason (§5.6), and a bot whose job is reproducing corpus material is exactly the profile that filter targets. If the model never emits the passage, the filter has nothing to fire on. A blocked response mid-demo would be indistinguishable from a crash.

Consequence for prompting: the answer-path prompt must instruct paraphrase-and-cite, and **must not** ask the model to quote. If an answer needs the exact wording, that is what the source card is for. Test case in `tests/adversarial.md`: a question whose natural answer *is* a passage.

Citations carry their text so the app renders a source card with no second request.

`citations` is `[]` for `out_of_corpus` and `ruling_seeking`. A non-empty `citations` array on those modes is a bug.

**Failure responses are a different shape, not a fourth `mode`.** `mode` describes *the question*; quota exhaustion and provider outages describe *the system*. Conflating them would force every consumer that switches on `mode` to grow a branch that has nothing to do with questions, and would drag infrastructure state into source-card rendering. Failures return **HTTP 503** with:

```jsonc
{ "error": { "code": "quota_exhausted",   // quota_exhausted | provider_unavailable | blocked
             "retryAfterSeconds": 30 } }  // our estimate — Gemini does not tell us (§5.6)
```

**Secrets checklist:**
- `.gitignore` contains `.env*` from the first commit
- `GEMINI_API_KEY` lives only in Vercel env vars — **one variable name, different value per Vercel environment** (Preview = dev project, Production = demo project). Never a `NODE_ENV` conditional picking between two keys in code; that is how the wrong key ships.
- The demo-project key exists **only** in Vercel Production. It should never be on the dev machine.
- A `DEPLOY_ENV` label var, logged at boot and returned by `/api/health` — the project cannot be derived from the key, so label it. Check it before demoing.
- `.env.example` committed with key names, no values
- Nothing sensitive in `app.config.js` / `eas.json` — Expo's `extra` block ships in the bundle
- Only the backend URL may use the `EXPO_PUBLIC_` prefix. Nothing else, ever.

**Abuse mitigation** (the endpoint is public and unauthenticated by design): IP rate limiting on the route, plus a spend cap set in the Google Cloud console. **Set the cap before the repo goes public** — the backend URL will be in it. On free tier the quota itself is the cap.

### 5.5 Ruling detection

Must catch ruling-seeking questions in **both English and Urdu**, including indirect phrasing.

English signals: "is it permissible", "halal", "haram", "should I", "is it allowed", "must I", "is it obligatory", "wajib", "sunnah to do"
Urdu/Roman-Urdu signals: "kya jaiz hai", "kya hukm hai", "kya karna chahiye", "jaiz", "hukm"

Indirect framings that must also be caught: "my friend wants to know if...", "hypothetically, would it be...", "in general, is it..."

Approach: cheap keyword prefilter, then LLM confirmation. Err heavily toward refusing. A false refusal is a minor cost; a false answer is a rubric failure.

**The keyword list is a one-way ratchet.** It may only ever escalate toward refusal, never toward answering. A keyword hit forces `ruling_seeking`; a keyword **miss proves nothing** and must never short-circuit to "safe". This is what makes the roman-Urdu spelling problem tolerable — `jaiz/jaez/jayaz` × `kya/kia/kea` × `hai/hy/he` can never be fully enumerated, but under a ratchet a missed spelling costs us nothing we had, because the model is still classifying independently.

**Precedence: `ruling_seeking` always beats `in_corpus`.** The dangerous case is not "is alcohol permissible" — it is **"is it sunnah to eat with the right hand?"**, where the corpus *does* cover the topic. A router that checks corpus coverage first sees a hit and answers, producing a fatwa that is worse for looking well-cited. Put this case, and its Urdu equivalents, at the top of `tests/adversarial.md`.

### 5.6 Provider adapter, quota strategy, and fixture testing

Docs read 2026-08-11; models and key verified against the live API 2026-08-12. Where a behaviour could not be confirmed, it says so — **do not fill those gaps by analogy with another provider, and do not reinstate numbers from an earlier draft.**

#### Project, key, and models — all verified against the live API

**Google Cloud project `268175794480`.** The account carries a **Google AI Pro subscription**, so free-tier published figures do not necessarily apply to us.

| Role | Exact model ID | Status | Verified |
|------|----------------|--------|----------|
| **Answering** | `gemini-2.5-flash` | **stable** (no `-preview` suffix) | ✅ 200, 2026-08-12 |
| **Routing** | `gemini-2.5-flash-lite` | **stable** | ✅ 200, 2026-08-12 |

`GET /v1beta/models` returns IDs prefixed `models/` (e.g. `models/gemini-2.5-flash`); the request path is `/v1beta/models/{bare-id}:generateContent`. Use the bare id in code.

⚠️ **Listed ≠ callable.** These same two models return **404 "no longer available to new users"** on a *different, newer* project — the restriction is by project age, not a shutdown. `GET /models` lists them regardless. **Never infer availability from the model list; call the model.** A startup smoke-check that both ids return 200 belongs in the deploy path.

🔑 **A stale `GEMINI_API_KEY` exists in the ambient shell environment. It belongs to a different Google account and a different project. NEVER use it.** The live key is in `.env` at the repo root (gitignored since the first commit). Any code or script that reads `process.env.GEMINI_API_KEY` without explicitly loading `.env` first will silently authenticate as the wrong account — this has already happened once. Load `.env` explicitly; do not fall back to the ambient value.

#### The scarce resource is REQUESTS, not tokens or money

Rate limits are **per project, not per API key** (confirmed in docs) and appear to be **per model**, so a two-model pipeline should draw on two independent buckets.

⚠️ **ALL NUMERIC LIMITS ARE CURRENTLY UNVERIFIED FOR THIS PROJECT.** An earlier draft of this file carried RPM/TPM/RPD figures read from a *different Google account's* dashboard; they described neither this project nor these models and have been deleted rather than adjusted. Do not design against remembered numbers.

| Quantity | Status |
|----------|--------|
| RPM per model | **unknown** — 5 concurrent requests to `gemini-2.5-flash-lite` did **not** trip a 429, so it is >5 concurrent |
| TPM per model | **unknown** |
| RPD, and whether it is per-model or project-wide | **unknown** |
| 429 response body / retry timing | **unverified** — could not trip one; docs document neither `Retry-After` nor `retryDelay` |

**To measure:** read the **`Gemini 2.5 Flash`** and **`Gemini 2.5 Flash-Lite`** rows in AI Studio for project `268175794480` and record RPM / TPM / RPD for each. Known spend against this project so far: **1 request to `gemini-2.5-flash`, 6 to `gemini-2.5-flash-lite`**, plus one `GET /models` — if the two models' daily counters differ by that split, RPD is per-model; if a single aggregate moved by 7, it is project-wide.

Architecture consequences that hold regardless of the exact numbers:

- **Refusals cost one request, not two.** If the router returns `out_of_corpus` or `ruling_seeking` there is no second call. Three of four rubric behaviours are refusals, and adversarial suites are mostly hostile questions.
- **The second call is close to free in RPM terms** *if* buckets are per-model, since the answering model is the bottleneck either way. Re-check once RPM is measured.
- **TPM is unlikely to bind.** Both models accept 1,048,576 input tokens and we send ~11k.
- ⚠️ **Free-tier inputs are used to improve Google products** (paid tier: they are not). Judges' questions at a public religious-content demo would be training data. Whether the AI Pro subscription changes this **needs checking** — it is a §2-shaped concern, not a privacy footnote.
- ❌ **Context caching is listed as unavailable on free tier.** Whether AI Pro changes that is **unchecked**. Assume the ~9.7k routing index is reprocessed every call; on free tier that costs latency, not money or quota.

**Decision: stay on free tier for now, no billing.** Fixtures and response caching (below) are therefore **load-bearing, not optional**. The escape hatch exists and is cheap — **Free → Tier 1 needs only billing enabled, takes effect instantly, and costs roughly $5 for this entire project** at $0.30/1M in and $2.50/1M out (~$0.005/question). Reach for it the moment quota becomes the bottleneck; do not architect around not having it.

#### Gemini failure modes — none of these may crash the demo

- **Blocked content is not returned** — `candidates` can be **empty**. Check before indexing.
- `finishReason: SAFETY`, plus `promptFeedback.blockReason` when the *prompt* was blocked.
- Generation-block codes include `safety`, **`recitation`**, `prohibited_content`, `language`, `blocklist`, `content_blocked`.
- Four adjustable safety categories (harassment, hate, sexually explicit, dangerous); **no religious category**, and extra filters are off by default on 2.5/3. Religious content should not be systematically blocked — but an adversarial question can still trip harassment or hate, so handle it.
- ⚠️ **`recitation` is a live risk for us specifically** — our bot reproduces corpus text, which is what a recitation filter looks for. **§5.4 already mitigates this**: citation `title`/`text` are read from the cached corpus after validation, never from model output, so verbatim quotes never pass through a Gemini response. Keep it that way deliberately — the model frames and connects, the source card carries the quote.
- ⚠️ **`responseSchema` enum is NOT a hard guarantee.** The docs support `enum` but state the model "is not guaranteed to strictly comply — always validate values in your application." **Code-side enum validation is therefore load-bearing, not belt-and-braces.** Validate `mode ∈ {in_corpus, out_of_corpus, ruling_seeking}` and **fail closed to `out_of_corpus`** on anything else — including empty candidates, a `SAFETY` finish, or a parse failure.
- **429 `RESOURCE_EXHAUSTED` carries no documented retry timing** — no `Retry-After` header, no `retryDelay` field. Retry blind, at most **once**, then give up. Retries consume RPD too; burning the daily budget guessing at backoff is a bad trade.

**The hard rule:** a quota, safety, or provider failure must **never** degrade into answering. If the router says `in_corpus` and the answer call fails, we return the 503 service message — never a partial, unvalidated, or from-memory answer. A system failure must not produce an unsourced religious claim (§2).

#### Provider adapter

Exactly two methods. Everything provider-specific lives behind them; no other file mentions Gemini or OpenRouter.

```
classify(question, language) → { mode, candidateIds }
answer(question, language, entries) → { answer, citations }
```

**Do not build a generic LLM abstraction** — no streaming, no tools, no embeddings, no message-array plumbing. Two methods, two result types, one error type. The moment it grows a `generate()`, we have built a worse SDK. Its second job is to be the fixture seam (below), so record/replay survives a provider swap — which, having switched once already, is not hypothetical.

**Client rule: the retry must wrap the response *read*, not just `fetch()`.** A timeout or abort can fire while the body is still streaming, so `await res.json()` has to sit **inside** the same `try` that covers the request. This bit us for real in `corpus:sync` — an 800 KB body aborted mid-stream, `res.json()` was outside the `try`, and the timeout escaped the retry entirely and killed the run. Both the Gemini and OpenRouter clients must follow the same shape. This matters more at runtime than at build time: an uncaught abort in the answer path is an unhandled rejection, and §5.2 requires every failure to land on the safe fallback rather than throw.

**Provider is selected by config, never by code path.** A single env var — `LLM_PROVIDER=gemini|openrouter` — picks the implementation at boot. Switching providers is an env change and a redeploy, not an edit. Anything that branches on provider *inside* the pipeline is a bug; the branch belongs at construction, once.

**Prompt differences are isolated.** If the fallback needs different prompt wording, it lives in that provider's own module beside its client, not in shared code and not behind conditionals. The `PROMPT_VERSION` that keys fixtures and the response cache (below) must therefore include the provider id — otherwise switching providers silently replays the wrong fixtures.

#### Fallback provider: OpenRouter — INSURANCE, not a second development lane

Verified working 2026-08-12 with the key in `.env` (`OPENROUTER_API_KEY`, loaded from `.env` only — never the ambient environment, same rule as §5.6's Gemini key).

| | |
|---|---|
| **Model** | **`google/gemma-4-26b-a4b-it:free`** — one model for **both** roles |
| **API** | OpenAI-compatible, `https://openrouter.ai/api/v1/chat/completions` |
| **Context** | 262,144 tokens — ~24× what we send |
| **Structured output** | `structured_outputs` **and** `response_format` both supported |
| **Verified** | Returned valid JSON, enum-valid `mode`, correctly classified a ruling question, and produced idiomatic Urdu — in one call |

**Why this model.** It was chosen against §5.6's criteria in priority order: it is one of only three `:free` models that support *both* structured-output parameters *and* are large enough to trust with classification; its 262k context is far beyond our ~11k need; and being a Google open-weight model it is the closest sibling to Gemini in the free roster, so prompts written for Gemini have the best chance of transferring without a rewrite. On the single test it classified `کیا شراب پینا جائز ہے؟` as `ruling_seeking` — the safety-critical behaviour — and wrote correct Urdu.

⚠️ **The Urdu evidence is one 29-character sentence. That is a signal, not an assessment.** Before ever relying on this fallback, generate a real answer-path sample and judge it as a native speaker. Many open-weight models are weak in Urdu and the corpus is §7.1-critical.

**One model, not a pair.** Unlike Gemini — where per-model rate buckets made the second call nearly free — **OpenRouter's free daily allowance is a single shared pool across all `:free` models.** Splitting roles across two models buys nothing, so we don't. Consequence: on OpenRouter our two-call pipeline yields **~25 questions/day**, not 50.

**Limits** (from OpenRouter docs, not measured):

- **20 requests/minute** on `:free` models, always
- **50 requests/day** with no credits ever purchased ← our current state
- **1,000 requests/day permanently** after a one-time **$10** purchase; credits never expire
- The daily limit is a **shared pool**, not per-model
- **No Google Gemini models are available free on OpenRouter** — the `google/*:free` entries are Gemma (open-weight), a different family

**Caveats to design around:**

- The `:free` roster **rotates, and endpoints are delisted without notice.** Re-verify the model id before depending on it; do not assume today's roster holds at judging. Treat a 404 from OpenRouter as "pick a new fallback", not "the fallback is broken".
- **Free endpoints may train on prompts** — the same §2-shaped concern as Gemini's free tier, and another reason this is insurance rather than the default.

**❌ No automatic failover.** Gemini must never fall back to OpenRouter mid-request. Silent provider switching would change model behaviour — refusal calibration, Urdu quality, JSON adherence — unpredictably and invisibly, and a demo that changes character halfway through is worse than one that returns an honest 503. Quota exhaustion surfaces as the typed 503 in §5.4. **The switch is manual: change `LLM_PROVIDER`, redeploy, verify.**

**This is insurance, and using it has a real cost.** We build and validate against Gemini. The fallback is verified once and then left alone. **We do not have the request budget to run the adversarial suite against both providers** — at 50/day shared, a single 20-question run would consume most of a day. So switching providers late means **shipping a router that has never been validated on the model actually serving it**: the fixtures replay Gemini's responses, not Gemma's, so a green suite would prove nothing about the live provider. That is the price of pulling this lever, and it should be paid only when Gemini is genuinely unavailable.

**Two independent escape hatches, if quota becomes the bottleneck:**

| Lever | Cost | Effect |
|-------|------|--------|
| Gemini **Free → Tier 1** | billing enabled, ~$5 total for this project | instant, removes the quota ceiling on the *validated* provider |
| OpenRouter **one-time $10** | $10, credits never expire | permanently raises 50/day → **1,000/day** on the fallback |

Prefer the Gemini lever: it buys headroom on the provider our tests actually cover. The OpenRouter purchase is worth making only if we expect to *run* on the fallback.

#### Fixture-based testing — the adversarial suite must not hit the live API

**Key:** `sha256(question + language + PROMPT_VERSION + model_id + schema_version)`. The prompt is part of the experiment, so it belongs in the key.

- **Record** (`FIXTURES=record`): hits live, writes `tests/fixtures/<hash>.json` containing the **entire raw response envelope** — `finishReason`, `safetyRatings`, `promptFeedback`, `usageMetadata` — not just the text. We need fixtures for the *failure* paths, not only the happy one.
- **Replay** (default, everywhere): the adapter reads the fixture and never touches the network. **A missing fixture fails the test loudly** — never a silent fallthrough to a live call, which is exactly how a "free" run quietly eats 40 requests.
- **Invalidation is automatic** via `PROMPT_VERSION` in the key. Bump it when a prompt changes; affected fixtures become misses. **Keep old fixtures** — a diff of router behaviour across prompt versions on the same 20 hostile questions is worth showing at judging.
- **Committed to the repo.** Small JSON, nothing secret, and CI then runs the suite at zero quota.

This is not only a quota saving. A suite that replays offline in ~2s gets run before every commit as §7.2 requires; one that costs 8 minutes of rate-limit waiting gets skipped precisely when we are rushing — which is when we are most likely to have broken the router.

**Optional, and worth it:** run the redundant ruling-check *only* in record mode, where we are spending requests deliberately. Disagreement between it and the router is a signal the router prompt needs work — redundancy where it is cheap, absent where it is expensive.

#### Response caching

- **Key:** `sha256(NFC-normalized + whitespace-collapsed + trimmed question + language + corpus_version + prompt_version)`. **NFC normalization is not optional** — Urdu and Arabic have multiple valid encodings of the same grapheme, so visually identical questions hash differently without it.
- **Store:** in-process LRU `Map`. No new dependency, no infrastructure. Dies on cold start, not shared across instances — acceptable for a single demo session.
- **Pre-seed at boot from a committed `demo-cache.json`** of rehearsed demo questions and their validated answers. The rehearsed demo then makes **zero API calls** and is immune to quota exhaustion, rate limiting, *and* a Gemini outage during judging. Novel judge questions still go live. This is our best demo insurance.
- **Invalidation is free** — `corpus_version` and `prompt_version` are in the key, so a corpus sync or prompt edit invalidates automatically. No purge logic.

---

## 6. Platform decision

The brief offers three platforms; participants choose **one**.

**Primary: `in_app`** — a chat widget in the form factor it would live in inside the Seerah app.

**Implementation: a real mobile app. React Native + Expo, distributed as an installable Android APK via EAS Build.**

Reasoning: the brief lists `in_app` and `web` as separate platforms because they *are* separate — different architecture, different distribution. A mobile-shaped web page would be a `web` submission wearing an `in_app` label. We are building the actual thing.

Consequences that follow from this, all mandatory:

- **The backend is not optional.** LLM API keys can never live in the app bundle — an APK is trivially extractable. The headless core (5.1) ships as a deployed server; the app is a client that calls it. Size the work as two deliverables, not one.
- **De-risk EAS Build early.** Run a throwaway hello-world APK build during Phase 1, not Phase 7. First builds always surprise you (bundle id, app config, credentials, queue time). Eat that pain while nothing is at stake.
- **Android only.** iOS distribution needs TestFlight, a paid Apple account, and a review queue — out of reach here. Mitigate at submission with a screen recording of the app working, so iOS judges can still evaluate it.
- **Test on a real device, not just the emulator.** They differ in ways that matter (keyboard behaviour, network, fonts, RTL rendering for Urdu).

Reasoning: the persistent disclaimer and the citation chips / source cards are explicit rubric items, and a rich UI surface satisfies them natively. WhatsApp is plain text — no persistent anything, and citations degrade to bracketed text. That is a rubric problem, not a budget problem.

**Stretch goal: `whatsapp`** as a *second* surface pointed at the same core, only once the core is solid and demo-able.

If we get both working, the demo line is: *same corpus, same guardrails, two channels.* That is a differentiator. But it is strictly a bonus — never at the cost of the primary surface.

Note for the record: WhatsApp is achievable free via Meta's Cloud API test number (instant, no business verification, up to 5 whitelisted recipients). We are not choosing web/in-app because WhatsApp is expensive — we are choosing it because it fits the rubric better.

---

## 7. Where we intend to win

Baseline submissions will answer questions and cite sources. To place above that, three areas:

1. **Urdu support — now a CORE path, not a stretch.** Phase 0 changed this. See below.
2. **Adversarial robustness.** Judges will try to break the guardrails. Maintain `tests/adversarial.md` with at least 20 hostile questions (indirect ruling requests, roleplay framing, prompt injection, half-covered topics, Urdu equivalents). Run the full list before every commit that touches the router or prompts.
3. **Verified citations.** See 5.3. This is demonstrable on stage and most submissions will not have it.

### 7.1 Urdu — core path, by selection not translation

Phase 0 promoted this from "nice differentiator" to "build it into the core from the start." **Every one of the 154 entries ships parallel `en` and `ur` blocks.** Titles are 154/154 in both languages; shamail `hadeesTarjama` 113/120 in both; timeline `content[]` 34/34 in both.

**The consequence is the important part: we SELECT a language block. We never translate.** The Urdu was written by the organizers' own scholars and shipped in the corpus. We are choosing which field to read.

**This removes translation-quality risk from religious content entirely** — and that risk was the single largest hazard in bilingual support. A machine-translated hadith is a fabricated hadith: same harm class as a hallucinated one (§2). Because we select, that failure mode does not exist for us. There is no translation step to get wrong. This is why Urdu is now cheap *and* safe, and why it moves ahead of the WhatsApp surface in priority.

The path:

1. **Detect the question's language.**
2. **Select that language's block** throughout — routing index, candidate entries, answer generation.
3. **Answer in kind.** Urdu question → Urdu answer. Never answer an Urdu question in English.
4. **Render citations from the same block**, so a source card never mixes scripts (§5.4).
5. **Localize the shell too** — fallbacks, refusals, the alim redirect, the persistent disclaimer, error states, empty states, the About screen. An English refusal on an Urdu question is a visible seam and the refusals are three of the four rubric items.

Two things Phase 0 flagged that will otherwise bite:

- **RTL must be tested on a real device, not the emulator.** Urdu is right-to-left, and RN's RTL handling differs between emulator and hardware — text alignment, cursor position, mixed-direction strings (an Urdu sentence containing `ﷺ`, a Latin name, or a digit), and where punctuation lands. The corpus is full of mixed-direction text: inline Arabic phrases, the ﷺ glyph (U+FDFA), Latin-script names inside Urdu prose, and numeric hadith references like `(صحیح بخاری حدیث 3560)`. Assume it renders wrong until seen on the device.
- **Roman-Urdu input is likely from real users.** The corpus itself carries `slug.romanUrdu` and roman-Urdu in `keywords[]` (`huzoor-ka-zaati-intiqam-na-lena`, `nby`, `akhlaqy`) — the organizers' own data models users who type Urdu in Latin script. So `"huzoor ka akhlaq kaisa tha"` is a realistic question, and language detection must handle it: **script is not a reliable language signal.** Roman-Urdu should route to Urdu content; whether it gets an Urdu-script or roman-Urdu *answer* is a §4-style open question — lean Urdu script, since that is what the corpus contains and what we can cite. This matters doubly for ruling detection (§5.5), where the signal words arrive as `kya jaiz hai` in Latin script.

---

## 8. Explicitly out of scope

Do not build these. Do not suggest them. If I ask for one, remind me it's on this list.

- User authentication / accounts
- Persisted chat history across sessions
- Streaming token-by-token responses
- Dark mode, theming, settings pages
- Admin panel or content management
- Analytics dashboards
- Vector database / embeddings (see 4B)
- Multi-turn conversation memory beyond what's needed for a coherent demo

---

## 9. How we work together

- **One concern per session.** Corpus fetch, then router, then answer path, then UI, then deploy. Do not sprawl across three concerns in one session — it makes diffs unreviewable.
- **I review every diff before it lands.** Show me what changed and why.
- **Stay demo-able at all times.** Get the ugliest possible end-to-end path working first (one question in, one cited answer out), then improve in layers. Never start a change that can't be finished within the session. We must never be at 90% with nothing to show.
- **Recon before code.** Never assume an API shape. Hit it, look at the real response, then build against what's actually there.
- **Flag conflicts, don't resolve them silently.** If the brief contradicts this file, or if something I've asked for contradicts section 2 or 3, stop and tell me.
- **Ask before adding dependencies.** Small dependency surface, fewer things to break at demo time.

---

## 10. Current status

- [x] **Phase 0 — Recon. COMPLETE.** API probed, real response shapes documented in `recon/`. Findings folded into §4, §5.3, §5.4, §7.1 and §11.
- [ ] **Phase 1 — Corpus bake + routing index.** ← we are here. Three deliverables: (a) `corpus:sync` writes the full 781 KB `corpus.json` — both languages, hikayat included; (b) build the ~9.7k-token bilingual routing index off it; (c) **throwaway EAS hello-world APK build to de-risk the pipeline.** **Also: throwaway EAS hello-world APK build to de-risk the pipeline.**
- [ ] Phase 2 — Guardrail router (3-way classification)
- [ ] Phase 3 — Answer path + citation validation
- [ ] Phase 3.5 — Deploy backend, app talks to live endpoint
- [ ] Phase 4 — Chat UI (source cards, persistent disclaimer)
- [ ] Phase 5 — Urdu support
- [ ] Phase 6 — Adversarial hardening
- [ ] Phase 7 — Deploy + demo rehearsal
- [ ] Stretch — WhatsApp surface

---

## 11. Open questions — all resolved in Phase 0

Answered by recon on 2026-08-11. Full evidence and raw responses in `recon/` — `recon/README.md` is the writeup.

- ~~**API host.**~~ **Resolved:** base URL is `https://api.islamicdesk.com/api/seerathon/corpus`, exactly as the brief states. The fallback path `/seerathon/corpus` 404s.
- ~~**Auth.**~~ **Resolved: none required** — anonymous GETs return 200. ⚠️ **Sending any `Authorization` header returns 403 `"Token Unauthorized!"`.** Never attach one to corpus requests. (`X-Api-Key` is ignored harmlessly.)
- ~~**CORS.**~~ **Resolved: fully open.** `Access-Control-Allow-Origin: *`; `OPTIONS` preflight returns 204. No proxy needed for corpus access. We still proxy the LLM call server-side per §5.4 — that constraint is about our key, not theirs.
- ~~**Language of the corpus.**~~ **Resolved: fully bilingual, parallel `en`/`ur` blocks on every entry**, with inline Arabic phrases, the ﷺ glyph, and roman-Urdu in `slug.romanUrdu` + `keywords[]`. Coverage: titles 154/154 in both languages; shamail `hadeesTarjama` 113/120 in both; timeline `content[]` 34/34 in both. **§7.1 is cheap and well-supported — we select a language block, we never translate.**
- ~~**What `q=` actually does.**~~ **Resolved: case-insensitive literal substring over a limited field set** — `title`, `hadeesTarjama`, `keywords[]`, and timeline `content[].title`. Not tokenised (`"revenge blasphemy"` → 0 hits), no fuzzy matching. **It does NOT search `points[]` or timeline `content_text`** — the bulk of the prose is invisible to it. Server-side search is not a usable retrieval mechanism; this reinforces §4B.
- ~~**Real entry counts.**~~ **Resolved: shamail 120, timeline 34, courses 20.** `limit=120` returns all 120 shamail in one request; `limit=500` clamps silently to 120. **The whole answer corpus is 154 entries in 2 requests.** Timeline is 34, not the ~50 §4B assumed. Rate limit: 60 req/min/IP.
- ~~**Submission requirements.**~~ **Resolved: a repo URL plus an APK link. No video required.** This validates the §6 platform decision — the APK *is* the deliverable, so a real installable Android build is not over-engineering, it is the submitted artifact. Judges will install and run it, which raises the stakes on first-question latency and on the app working offline-of-the-organizers'-API (hence baking, §5.4).

### Where these findings landed

Phase 0 changed real decisions rather than just filling gaps. Each is now written into the section it affects — this list is the index, not the content:

- **§4 — API gotchas.** New subsection: the `Authorization` → 403 trap, HTTP-200 errors, hex-string ids, non-unique slugs, open CORS, and `q=` being unusable for retrieval.
- **§4B — counts and size corrected.** 120 + 34 = 154 entries (153 usable). Size was 30–40k assumed, ~46k–280k measured. The no-RAG rule survives via the two-stage routing index; §4B now spells out why that is not RAG.
- **§4 — disclaimer decision made.** Both: a short user-facing one in chat, the verbatim `/meta` string on an About screen.
- **§5.3 — citation validation went from one check to three.** Existence is not content; language coverage is not symmetric. This is the section Phase 0 changed most, and it is the safety mechanism.
- **§5.4 — response contract corrected.** Hex-string ids, `language` on both request and response, citations carrying `id`/`type`/`title`/`text` read from cache after validation.
- **§7.1 — Urdu promoted to core path.** Parallel `en`/`ur` on every entry means selection, not translation, which deletes translation-quality risk on religious content.

**Nothing remains open from the original Phase 0 list.** New open questions raised *by* recon, to settle in their phases: whether roman-Urdu questions get Urdu-script or roman-Urdu answers (§7.1, lean Urdu script), and the exact wording of the short user-facing disclaimer (§4, Phase 4).

### Provider verification, 2026-08-12

Run against the live Gemini API on project `268175794480`. Full detail in §5.6.

- ✅ **`gemini-2.5-flash` and `gemini-2.5-flash-lite` are both callable** on this project. Both stable. Model selection settled.
- ⚠️ **Model availability is project-scoped and `GET /models` lies about it.** Both models return **404 "no longer available to new users"** on a newer project while still being listed by the models endpoint. Availability must be verified by *calling*, never by listing.
- 🔑 **A stale `GEMINI_API_KEY` sits in the ambient shell environment**, belonging to a different account and project. The live key is in `.env`. Anything reading `process.env` without loading `.env` first authenticates as the wrong account — this already happened once and spent ~7 requests on the wrong project.
- ❌ **All previous quota numbers were deleted, not corrected.** They came from a different account's dashboard. RPM, TPM, RPD and RPD scoping are all **unknown** for this project; the account's AI Pro subscription may raise them above published free-tier figures.
- ⚠️ **429 shape still unverified.** 5 concurrent requests to `flash-lite` did not trip a limit, so RPM is >5 concurrent. Retry timing remains undocumented — design for blind backoff.
- **Measurement pending (yours):** read the `Gemini 2.5 Flash` and `Gemini 2.5 Flash-Lite` rows for project `268175794480`. Spend so far is 1 request to `flash` and 6 to `flash-lite` — the split tells us whether RPD is per-model or aggregate.

---

## 12. Design language — from the real app

Reference screenshots in `docs/design-reference/` (the live **Seerat Ki Duniya** app — the Seerah app our widget is meant to live inside). Extracted 2026-08-12. **This section governs Phase 4. It is documentation, not a licence to start building UI.**

### 12.1 What the reference actually looks like

**One sentence:** warm, paper-like and unhurried — cream grounds instead of stark white, deep forest green for authority, gold for reverence, generous rounded geometry and a lot of breathing room. It reads as a modern learning app wearing the visual manners of Islamic devotional print: calm and respectful, never clinical and never "techy".

**Palette** (sampled from the screenshots; treat as ±a shade, tune on device):

| Role | Hex | Where it appears |
|------|-----|------------------|
| Background | `#F7F5F0` | every screen — a warm cream, **not** white |
| Banded surface | `#F0ECE1` | timeline section headers, alternating strips |
| Surface | `#FFFFFF` | cards, list items, chips |
| Primary | `#14483A` | hero banners, "Enroll now", active tab, headings, stat numbers |
| Primary (deep) | `#0F3D2E` | the darkest banner fills |
| Gold | `#E0A63C` | "Continue" button, "Continue reading" label, logo dome |
| Accent (high-emphasis CTA) | `#F5842C` | "See Details" — used **once per screen**, sparingly |
| Text primary | `#1C1C1A` | titles, body |
| Text secondary | `#82827A` | meta, labels, inactive tabs |
| Divider / track | `#E6E2D8` | hairlines, progress tracks |

Note the split: the **logo** is teal + gold, but the **UI** is green + gold. Follow the UI. Teal appears nowhere in the product chrome.

**Typography.** English is a rounded geometric sans with double-storey `a` and soft terminals (Nunito/Quicksand family — match the characteristics, don't chase the exact licence). Screen titles ~23px bold; card titles ~18px semibold; body ~15–16px regular at ~1.55 line height; meta ~13px in secondary grey; stat numbers ~30px bold in primary green. Urdu is naskh, noticeably larger than the English at the same rank (Urdu needs ~1.15–1.25× the size and ~1.7 line height to stay legible), and `ﷺ` renders as a true calligraphic ligature — **their app does render U+FDFA**, which is a useful signal for our Phase 1(c) font check. English and Urdu are never mixed mid-sentence in chrome; the app switches wholesale via a **`UR / EN` pill toggle in the header**, which is the pattern we should copy for §7.1.

**Spacing and shape.** 16–20px screen padding; 16px card radius, 12px on buttons and chips, 20px+ on hero banners; 16–20px card padding; 12–16px between cards. Elevation is almost flat — a barely-there shadow, and in places (profile stat cards) a **1px dashed border** instead of a shadow, which is a distinctive tic worth borrowing. Section headers are full-bleed tinted bands, not floating labels.

**Components.** Header: large bold title, left-aligned on cream, hairline divider, optional circular icon buttons right. Bottom tab bar: 6 line icons + labels, active in primary green. Buttons: full-width, solid, 12px radius. Chips: white pill, thin border, green border when selected. List rows: white card, thumbnail left, title, meta line, thin progress bar. Icons: line style, ~1.75px stroke, rounded caps.

### 12.2 Mapping onto our surfaces

| Our surface | How it should sit in that language |
|---|---|
| **Chat screen** | Cream `#F7F5F0` ground, not white. Header matches theirs exactly — large bold title left, hairline divider, and the **`UR / EN` pill on the right**, reusing their toggle so language switching feels native rather than bolted on. |
| **User message** | Primary green `#14483A` fill, white text, 16px radius with the bottom-right corner tightened to ~4px. Right-aligned in LTR; **mirrored in RTL** (§7.1). |
| **Bot message** | White surface on cream, 16px radius, bottom-left tightened. Near-black text. Flat with a hairline `#E6E2D8` border rather than a shadow — the reference is flat, and a floating bubble would read as a different app. |
| **Citation chip** | Their selected-chip pattern exactly: white pill, 10–12px radius, thin green border, primary-green label, ~13px. Sits directly under the bot message. Tapping expands the source card. Never more than a line of text — it is a handle, not the evidence. |
| **Source card** | The list-row card, reused: white, 16px radius, 16px padding. Entry title at card-title weight; corpus text at body size in secondary-dark; hawala reference in `#82827A` meta. A 3px gold `#E0A63C` left rule marks it as quoted scripture — the one place gold earns its reverence connotation. Renders the language from `response.language`, never mixed (§5.4). |
| **Refusal / alim redirect** | Same white bot bubble, no red, no warning iconography. This is a courtesy, not an error — a gold left rule and a calm line of text. Treating a refusal as an error state would misrepresent three of the four rubric behaviours. |
| **Persistent disclaimer bar** | Pinned above the composer, full-bleed, banded surface `#F0ECE1` with a hairline top border, 12px secondary text, centred, non-dismissible. Deliberately the quietest element on the screen — permanently visible without competing with content. **See the conflict below.** |
| **About / Corpus Rules screen** | Their settings-page idiom: cream ground, sectioned white cards. The verbatim `/meta` disclaimer and all five `usage_rules`, both `en` and `ur`, reproduced exactly (§4). Reached from a circular icon button in the chat header, matching their header-button pattern. |
| **Empty / first-run state** | Centred derived mark, one line of orientation text, and 3–4 example questions as tappable chips — one in-corpus, one out-of-corpus, one ruling-shaped. This doubles as the demo script and shows the guardrails before a judge has to think of a question. |

### 12.3 Two constraints, both binding

**Match the language, not the assets.** Do **not** reproduce their logo. The mark is a gold dome-and-finial silhouette enclosing teal Urdu calligraphy; ours should sit in the same family — a single-weight gold line-drawn form on cream, geometric, unfussy — while being plainly a different mark. A dome outline enclosing a **chat/speech form** rather than calligraphy reads as the same house and says what this thing actually is. No calligraphic reproduction of their wordmark, and no lifting their PNG assets.

**Where the reference and the rubric conflict, the rubric wins — and we note the conflict rather than dropping the requirement.** One real instance:

> **The persistent disclaimer bar has no equivalent in their app.** Nothing in the reference is permanently pinned above the input; their screens are clean, content-first, and unchromed. A persistent bar is therefore *off-style by construction*. It ships anyway — `usage_rules[5]` requires it and it is one of the four demo behaviours (§2). We reduce the friction by making it the quietest thing on screen (banded surface, secondary text, hairline rule), **not** by making it dismissible, collapsible, or shown-once. If it ever comes down to "it looks cleaner without it", it stays.

Smaller conflicts to expect: the reference uses orange for its one high-emphasis CTA per screen, but our chat surface has no such CTA — **do not** find a use for orange just to match; leaving it unused is correct. And the reference renders `576.577` raw in its own timeline (screen 2) — we render `576–577 CE` (§ Phase 1a). Matching their design language does not mean inheriting their data bugs.
