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

**153 of the 154 are usable.** Entry `67824f4d53748aebf74997ab` ("The blessed tongue of the Prophet Muhammad ﷺ") has titles in both languages and **no body text in either**. It is citable but has nothing to say — see §5.3.

Token cost, measured in Phase 0 (estimates, ±25%):

| Configuration | Est. tokens | Fits a 200k window? |
|---------------|-------------|---------------------|
| English only, no hikayat | **~46k** | ✅ comfortably |
| Urdu only, no hikayat | ~76k | ✅ |
| Bilingual, no hikayat | **~122k** | ✅ but expensive on every call |
| Bilingual + `include_hikayat` | **~280k** | ❌ **exceeds the window** |

So "stuff the whole corpus into every prompt" is viable only in the narrowest English-only slice, and impossible at full fidelity.

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

### 5.3 Citation validation (the key safety mechanism)

The model returns JSON: `{ answer, citations: [entry_id, ...] }`.

Then, **in code, not in the prompt**, every returned `entry_id` must pass **all three** checks. Phase 0 showed that "the id exists" is not sufficient.

**Check 1 — the id exists** in the cached corpus. Exact match against a hex-string key. Catches an outright invented citation.

**Check 2 — the entry has body text.** *Existence is not content.* Entry `67824f4d53748aebf74997ab` has titles in both languages and an empty body — it would pass check 1 while grounding nothing. And `hadeesTarjama` is present on only **113 of 120** shamail entries, `points[]` on only **50 of 120**. A model that cites a title-only entry has, in practice, answered from its own knowledge and attached a decorative reference. That is the exact failure mode this section exists to prevent.

**Check 3 — the body exists in the language being answered in.** Coverage is *not* symmetric between `en` and `ur` — e.g. `hadeesHawala` is present on 112/120 in English but 119/120 in Urdu, and one entry has Urdu-only content. Citing an entry whose text exists only in the other language produces a source card the user cannot read, and an answer that cannot be checked against its own citation.

Any check failing on **any** citation, or **zero citations returned** → discard the answer entirely and fall through to the safe fallback. Never repair, never partially render, never show the answer with the bad citation stripped out — a wrong answer with the evidence removed is worse than no answer.

This is still deterministic, still ~40 lines, and still means a hallucinated or hollow citation cannot reach the user's screen. **Hard requirement, not an optimization.** Never trust the model's self-reported citations.

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

Citations carry their text so the app renders a source card with no second request.

`citations` is `[]` for `out_of_corpus` and `ruling_seeking`. A non-empty `citations` array on those modes is a bug.

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
