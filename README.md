# Seerathon — a Seerah & Shamail Q&A bot that refuses on purpose

A bilingual (English / Urdu) Android app that answers questions about the Seerah and the Shamail **only** from the corpus the organizers published — and declines, visibly and by design, when a question falls outside it or asks for a religious ruling.

Submitted for the **Seerathon**, role *Developers / AI Engineers*, platform **`in_app`** — a real installable Android build, not a mobile-shaped web page.

---

## Install

**[⬇ Download the APK](https://github.com/MuhammadAliAbbas1/Seerathon-AI-Bot/releases/latest)**

1. Open the file on your Android phone.
2. Android will ask permission to install from your browser or file manager. **This prompt appears for any app not distributed through the Play Store** — it is expected here.
3. Allow it and open the app.

No accounts, no API keys, nothing to configure — the app talks to a hosted backend. Android only; iOS distribution needs a paid Apple account and a review queue.

You can check the backend is live without installing anything: **[`/api/health`](https://seerathon-api.vercel.app/api/health)**.

---

<!-- SCREENSHOTS — add the two image files before publishing, or delete this block.
     See docs/screenshots/README.md for what each one should show. -->

| A cited answer | A ruling question, refused |
|---|---|
| ![An answer with its source card open](docs/screenshots/01-answer.png) | ![A ruling question redirected to a scholar](docs/screenshots/02-ruling.png) |

---

## Why this one is different

Every entry in this category grounds answers in the corpus, cites sources, handles out-of-corpus questions and redirects fatwa questions. Those are the brief. Here is what sits underneath them.

**Citations are validated in code, after the model answers.** Three checks on every returned id: the entry exists, it has body text, and that body exists *in the language being answered in*. Any citation failing any check — or an answer with zero citations — discards **the entire answer** and falls back. Nothing is repaired, nothing is partially rendered. This is the difference between *"cites sources"*, which is a prompt instruction, and *"cannot display an unverified citation"*, which is a property of the code.

**Refusing a ruling takes precedence over having the answer.** The dangerous question is not *"is alcohol permissible"* — it is **"is it sunnah to eat with the right hand?"**, where the corpus genuinely covers the topic. A pipeline that checks coverage first finds a hit, answers, and produces a fatwa that is *worse for being well-cited*. Ruling-shape is checked first, and there is a test named after that exact question.

**Ruling detection can fire without calling the model at all.** A keyword ratchet runs first and refuses on a hit, costing zero API requests. A miss proves nothing and falls through to the model. The ratchet may only ever escalate toward refusal — so for the vocabulary it covers, there is no model in the loop to talk out of it.

**The classifier fails closed, because the provider does not guarantee otherwise.** Gemini's documentation states the model "is not guaranteed to strictly comply" with a response schema. So an off-enum value, malformed JSON, empty candidates, a safety block, a truncated response, a rate-limit error or a timeout all land on the safe fallback — and never throw. Each of those is tested with hand-written broken responses.

**The model never generates corpus text.** Answers are the model's own words. Verbatim hadith text reaches the screen only by being read out of the cached corpus into the source card. That is both the shape the brief asks for — an answer *with* a citation, not a quotation — and a way to keep a recitation filter from having anything to fire on.

**Urdu is selected, never translated.** The corpus ships parallel `en` and `ur` blocks written by the organizers' scholars. The bot picks a block. There is no translation step, which matters because **a machine-translated hadith is a fabricated hadith** — the same class of harm as a hallucinated one.

**The corpus is baked at build time.** 154 entries compiled into the deployment. If the organizers' API is unreachable during judging, the bot still works.

**A failure is never allowed to lie about its cause.** A routing outcome or a failed citation check gets the refusal copy — true: there is nothing we can stand behind. A quota exhaustion, timeout or provider outage gets a typed HTTP 503 — also true: our call broke. Letting the second wear the first's copy would look more graceful and would be false.

---

## How it works

```
question
   ↓
guardrail router  ← classifies BEFORE any answer is generated
   ↓
   ├── in_corpus      → send the selected entries → answer → VALIDATE CITATIONS → render
   ├── out_of_corpus  → safe fallback, no guessing
   └── ruling_seeking → refuse, redirect to a scholar
```

Retrieval is two-stage and deliberately **not** RAG — no vector store, no embeddings, no chunking, no similarity threshold. All 154 entries fit in a single prompt as a routing index (one line each: id, source, category, both titles, keywords), so the model selects from a complete list rather than from a lossy projection of one. Stage two sends the full text of only the selected ids.

The backend is a plain HTTP endpoint with **zero runtime dependencies** — `POST /api/ask` in, structured JSON out. The app is a thin client over it. No API key ever enters the app bundle.

---

## Try these

The app's landing screen offers these as one-tap examples, each labelled with what will happen:

| Question | Outcome |
|---|---|
| What was the Prophet's ﷺ character like? | answered, with its source |
| What did the Prophet ﷺ think about cryptocurrency? | declined — not in the collection |
| Is it sunnah to eat with the right hand? | declined — redirected to a scholar |
| حضور ﷺ کا اخلاق کیسا تھا؟ | answered in Urdu, with Urdu sources |

The first and last are the same question in two scripts, so the bilingual behaviour is comparable without reading Urdu.

---

## Repo map

| Path | What's there |
|---|---|
| `api/src/` | The pipeline — router, answer path, citation validation, provider adapter |
| `api/src/ruling-keywords.ts` | The one-way ratchet, and why a miss proves nothing |
| `tests/adversarial.md` | 60 adversarial cases — prompt injection, roleplay framing, indirect ruling requests, retry attacks, Urdu and roman-Urdu equivalents |
| `tests/cases.ts` | The single source of truth those tables are generated from |
| `recon/` | Verbatim captured responses from the organizers' API, and what probing it actually found |
| `docs/stack.md` | Why this stack, what it costs, and where the choice is worse |
| `CLAUDE.md` | The full design record, including the mistakes |
| `mobile/` | The React Native app |

---

## Run it yourself

```bash
npm install
npm run check
```

`npm run check` runs 138 tests plus three drift checks, **offline, in about two seconds, spending zero API quota.** Model responses are recorded fixtures replayed from `api/fixtures/`, so the adversarial suite is cheap enough to run before every commit — which is the point, because a suite that costs quota gets skipped exactly when you are rushing.

Only reproducible outcomes are ever recorded as fixtures. Transient failures — quota, timeouts, transport, any HTTP status — must be re-run, because a recorded 503 once sat in this suite replaying in 2ms and reporting a pass for a case that had never actually been tested.

---

## Honest limitations

- **Android only.** No iOS build.
- **The Urdu register has not been reviewed by a native speaker.** The mechanism is sound — text is selected from the corpus, never translated — but the shell copy written for this app is unaudited, and at least one word choice in the refusal labels is still an open question.
- **Rate limiting is per-instance, in-process.** It stops one person or one script hammering the endpoint. It does **not** stop a distributed attacker, and it resets on cold start. That is an accepted trade, not an oversight: fixing it properly means adding a datastore and a service for a threat model this project does not have. The real ceiling is the provider's free-tier quota.
- **One adversarial case is unconstructible.** It needs a corpus entry with body text in only one language; the published corpus has none, so it is recorded as unconstructible rather than quietly skipped.
- **No multi-turn memory.** Each question is answered on its own, which keeps the router's input predictable.
- **The demo has not been rehearsed end to end.** Known gap, honestly the largest one.

---

## License

MIT — see [LICENSE](LICENSE). The corpus itself is the organizers' and is not covered by it.
