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

(Host confirmed by the organizers. The exact path join is unverified until Phase 0 recon — if `https://api.islamicdesk.com/api/seerathon/corpus/meta` 404s, try `https://api.islamicdesk.com/seerathon/corpus/meta` before assuming the API is down.)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/meta` | Counts, version, disclaimer text, usage rules |
| GET | `/shamail` | Shamail list (paginated) |
| GET | `/shamail/:id` | One Shamail entry |
| GET | `/timeline` | Seerah timeline list (paginated, plain text) |
| GET | `/timeline/:id` | One timeline entry |
| GET | `/courses` | Course titles index only |

Query params: `page`, `limit` (max 120), `q` (search text), `category_id` (Shamail only), `section` (Timeline only), `include_hikayat=true` (Shamail only, longer text).

### Two critical constraints

**A. Answer corpus = Shamail + Timeline ONLY.**
`/courses` is index/reference only. We may say "this topic is covered in course X" as a pointer. We may **never** answer *from* course content. Courses are a signpost, not a source.

**B. The corpus is small — approximately 120 Shamail entries + ~50 timeline entries.**

This is the decision that shapes the whole architecture. That is roughly 30–40k tokens total, which fits in a context window.

**So: DO NOT build RAG.** No vector database, no embeddings, no chunking strategy, no similarity thresholds. All of that machinery exists to solve "my corpus is too big for the context window," and ours is not. Fetch the entire corpus once at boot, cache it, and pass the relevant slice directly into the prompt.

If recon reveals the corpus is dramatically larger than expected, stop and tell me before building anything — that changes this decision.

### Disclaimer text
Use the disclaimer string returned by `/meta` **verbatim**. Do not write our own. The organizers wrote that field and will look for it.

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

### 5.3 Citation validation (the key safety mechanism)

The model returns JSON: `{ answer, citations: [entry_id, ...] }`.

Then, **in code, not in the prompt**, we verify that every returned `entry_id` actually exists in the cached corpus.

- Cites an id that doesn't exist → discard the answer, fall through to safe fallback
- Cites nothing at all → discard the answer, fall through to safe fallback

This is ~20 lines, it is deterministic, and it means a hallucinated citation can never reach the user's screen. **This is a hard requirement, not an optimization.** Never trust the model's self-reported citations.

### 5.4 Secrets and the backend boundary

**No LLM API key ever enters the app bundle.** An APK is trivially extractable. The app ships with exactly one piece of config — the backend URL — and nothing else.

```
App  →  our backend (holds the key)  →  Anthropic API
                                     →  baked corpus.json
```

All guardrail logic, routing, and citation validation live server-side. A modified client must not be able to bypass them.

**Corpus is baked at build time, not fetched at runtime.** A `npm run corpus:sync` script pulls the full corpus from `api.islamicdesk.com` and writes `corpus.json` into the repo; the server imports it as a static object. This removes runtime latency, makes citation validation an object lookup, and — critically — means we still work if the organizers' API goes down during judging.

**Endpoint contract** — one route, `POST /api/ask`:

```jsonc
// request
{ "question": "...", "language": "en" }

// response
{
  "mode": "in_corpus",          // in_corpus | out_of_corpus | ruling_seeking
  "answer": "...",
  "citations": [ { "id": 47, "type": "shamail", "text": "..." } ]
}
```

Citations include the source text so the app can render a source card with no second request.

**Secrets checklist:**
- `.gitignore` contains `.env*` from the first commit
- `ANTHROPIC_API_KEY` lives only in Vercel env vars
- `.env.example` committed with key names, no values
- Nothing sensitive in `app.config.js` / `eas.json` — Expo's `extra` block ships in the bundle
- Only the backend URL may use the `EXPO_PUBLIC_` prefix. Nothing else, ever.

**Abuse mitigation** (the endpoint is public and unauthenticated by design): IP rate limiting on the route, plus a spend cap set on the API key in the provider console. The spend cap is the real protection.

### 5.5 Ruling detection

Must catch ruling-seeking questions in **both English and Urdu**, including indirect phrasing.

English signals: "is it permissible", "halal", "haram", "should I", "is it allowed", "must I", "is it obligatory", "wajib", "sunnah to do"
Urdu/Roman-Urdu signals: "kya jaiz hai", "kya hukm hai", "kya karna chahiye", "jaiz", "hukm"

Indirect framings that must also be caught: "my friend wants to know if...", "hypothetically, would it be...", "in general, is it..."

Approach: cheap keyword prefilter, then LLM confirmation. Err heavily toward refusing. A false refusal is a minor cost; a false answer is a rubric failure.

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

1. **Urdu support.** The brief is fully bilingual and the audience is Urdu-speaking. Answering in Urdu when asked in Urdu — with the disclaimer, fallbacks, and refusal messages localized too — is high leverage and most submissions will be English-only.
2. **Adversarial robustness.** Judges will try to break the guardrails. Maintain `tests/adversarial.md` with at least 20 hostile questions (indirect ruling requests, roleplay framing, prompt injection, half-covered topics, Urdu equivalents). Run the full list before every commit that touches the router or prompts.
3. **Verified citations.** See 5.3. This is demonstrable on stage and most submissions will not have it.

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

- [x] **Phase 0 — Recon.** API probed, real response shapes documented in `recon/`. See §11 for answers and the corrections it forced.
- [ ] Phase 1 — Corpus fetch + cache. ← we are here **Also: throwaway EAS hello-world APK build to de-risk the pipeline.**
- [ ] Phase 2 — Guardrail router (3-way classification)
- [ ] Phase 3 — Answer path + citation validation
- [ ] Phase 3.5 — Deploy backend, app talks to live endpoint
- [ ] Phase 4 — Chat UI (source cards, persistent disclaimer)
- [ ] Phase 5 — Urdu support
- [ ] Phase 6 — Adversarial hardening
- [ ] Phase 7 — Deploy + demo rehearsal
- [ ] Stretch — WhatsApp surface

---

## 11. Open questions — resolved in Phase 0

Answered by recon on 2026-08-11. Full evidence and raw responses in `recon/` — `recon/README.md` is the writeup.

- ~~**API host.**~~ **Resolved:** base URL is `https://api.islamicdesk.com/api/seerathon/corpus`, exactly as the brief states. The fallback path `/seerathon/corpus` 404s.
- ~~**Auth.**~~ **Resolved: none required** — anonymous GETs return 200. ⚠️ **Sending any `Authorization` header returns 403 `"Token Unauthorized!"`.** Never attach one to corpus requests. (`X-Api-Key` is ignored harmlessly.)
- ~~**CORS.**~~ **Resolved: fully open.** `Access-Control-Allow-Origin: *`; `OPTIONS` preflight returns 204. No proxy needed for corpus access. We still proxy the LLM call server-side per §5.4 — that constraint is about our key, not theirs.
- ~~**Language of the corpus.**~~ **Resolved: fully bilingual, parallel `en`/`ur` blocks on every entry**, with inline Arabic phrases, the ﷺ glyph, and roman-Urdu in `slug.romanUrdu` + `keywords[]`. Coverage: titles 154/154 in both languages; shamail `hadeesTarjama` 113/120 in both; timeline `content[]` 34/34 in both. **§7.1 is cheap and well-supported — we select a language block, we never translate.**
- ~~**What `q=` actually does.**~~ **Resolved: case-insensitive literal substring over a limited field set** — `title`, `hadeesTarjama`, `keywords[]`, and timeline `content[].title`. Not tokenised (`"revenge blasphemy"` → 0 hits), no fuzzy matching. **It does NOT search `points[]` or timeline `content_text`** — the bulk of the prose is invisible to it. Server-side search is not a usable retrieval mechanism; this reinforces §4B.
- ~~**Real entry counts.**~~ **Resolved: shamail 120, timeline 34, courses 20.** `limit=120` returns all 120 shamail in one request; `limit=500` clamps silently to 120. **The whole answer corpus is 154 entries in 2 requests.** Timeline is 34, not the ~50 §4B assumed. Rate limit: 60 req/min/IP.
- **Submission requirements.** ⛔ **STILL UNANSWERED — not discoverable from the API.** Repo? Live URL? Video? Deadline? Ask the organizers; this gates Phase 7.

### Corrections to this file that recon forced

- **§5.4 endpoint contract is wrong about ids.** It shows `"id": 47`. Real ids are **24-char hex ObjectId strings** (`"672b3e8ed458540020750eab"`). Slugs are **not** unique (150 distinct across 154 entries) — cite by `id` only. Fix before Phase 3.
- **§4B's size estimate was low.** Not 30–40k tokens. Measured (estimates, ±25%): **English only, no hikayat ≈ 46k**; bilingual ≈ **122k**; bilingual + `include_hikayat` ≈ **280k — exceeds a 200k window.** The no-RAG decision survives via a two-pass approach: a bilingual routing index over all 154 entries costs **~9.7k tokens**, then fetch full text for the few candidate ids. Still no vector DB, no embeddings, no chunking. **Recommended, not decided — see `recon/README.md`.**
- **Errors come back as HTTP 200** with `{"error": true, "data": null, "msg": "..."}`. Status codes are useless here; always branch on `body.error`.
- **§4A confirmed correct.** The brief contradicts itself on courses; the API settles it in two places — `/meta` `usage_rules[0]` ("Answer only from this corpus (Shamail + Seerah Timeline)") and `/courses` `data.note` ("Courses index only… Use Shamail + Timeline as the answer corpus"). No course body content exists in the API to answer from.
- **One entry is empty:** `67824f4d53748aebf74997ab` has titles in both languages and no body text in either. "Entry exists" ≠ "entry has content" — the answer path must check.
- **Open for Phase 4:** the `/meta` disclaimer string is addressed to the *bot builder* ("Cite every answer…", "Refuse fatwa questions…"), not the end user. §4 says render it verbatim. Rendering it as the in-chat persistent disclaimer would read as leaked system prompt. Suggested: show it verbatim in an about/rules affordance *and* a short user-facing disclaimer in the chat surface. Your call.
