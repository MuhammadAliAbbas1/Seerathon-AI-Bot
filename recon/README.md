# Phase 0 — Corpus API Recon

Probed 2026-08-11 against `https://api.islamicdesk.com`.
Every raw response in this directory was captured verbatim; response headers are under `headers/`.

---

## Base path — RESOLVED

| Candidate | Status |
|-----------|--------|
| `https://api.islamicdesk.com/api/seerathon/corpus/meta` | **200** ✅ |
| `https://api.islamicdesk.com/seerathon/corpus/meta` | 404 |

**Base URL is `https://api.islamicdesk.com/api/seerathon/corpus`** — matches the brief exactly.

---

## Endpoint results

All returned HTTP 200. `curl` with no headers at all works.

| Endpoint | Status | Bytes | Raw file |
|----------|--------|-------|----------|
| `/meta` | 200 | 1,871 | `meta.json` |
| `/shamail?limit=5` | 200 | 6,952 | `shamail_limit5.json` |
| `/shamail?limit=120` | 200 | 205,848 | `shamail_limit120.json` |
| `/shamail?limit=120&include_hikayat=true` | 200 | 781,510 | `shamail_limit120_hikayat.json` |
| `/shamail/:id` | 200 | 1,947 | `shamail_by_id.json` |
| `/shamail/:id?include_hikayat=true` | 200 | 6,080 | `shamail_include_hikayat.json` |
| `/timeline?limit=5` | 200 | 18,201 | `timeline_limit5.json` |
| `/timeline?limit=120` | 200 | 319,607 | `timeline_limit120.json` |
| `/timeline/:id` | 200 | 3,153 | `timeline_by_id.json` |
| `/courses` | 200 | 16,010 | `courses.json` |
| `/shamail?q=sanctity` | 200 | 1,985 | `shamail_q_search.json` |
| `/shamail?q=صبر` | 200 | 1,506 | `shamail_q_urdu.json` |
| `/timeline?q=Abwa` | 200 | 2,549 | `timeline_q_search.json` |

Ids used: shamail `672b3e8ed458540020750eab`, timeline `6720dac1205912001e0bed87`.

---

## Envelope

Every response, success or failure:

```jsonc
{ "error": false, "data": { ... }, "msg": "Corpus shamail fetched successfully" }
```

- **List endpoints:** `data.items[]`, `data.total`, `data.page`, `data.limit`, `data.pages`, `data.corpus_version`
- **Single-entry endpoints:** `data.item` (singular — *not* `items`), `data.corpus_version`
- **`/courses` additionally carries `data.note`**

### ⚠️ Errors return HTTP 200

```
GET /shamail/000000000000000000000000  → 200  {"error":true,"data":null,"msg":"Shamail not found"}
GET /shamail/not-an-id                 → 200  {"error":true,"data":null,"msg":"Shamail not found"}
```

**Status codes cannot be used for error handling. Always branch on `body.error`.**

---

## Auth — none required, and an `Authorization` header BREAKS it

| Request | Status |
|---------|--------|
| No headers | 200 |
| `X-Api-Key: abc` | 200 (ignored) |
| `Authorization: Bearer abc` | **403** `{"error":true,"data":null,"msg":"Token Unauthorized!"}` |
| `Authorization: Bearer` | **403** |
| `Authorization: xyz` | **403** |

Any `Authorization` header of any form is rejected by a global auth middleware. The corpus routes are
open to anonymous callers only. **Never attach an `Authorization` header to corpus requests.**

---

## CORS — fully open

```
Access-Control-Allow-Origin: *
```

Present on GETs. `OPTIONS` preflight → `204` with
`Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE`.

Browser-origin calls work. No server-side proxy is required for corpus access.
(We proxy anyway — the LLM key must stay server-side per CLAUDE.md §5.4 — but this is not a blocker.)

---

## Rate limit

`/meta` reports `rate_limit: { window_seconds: 60, max_per_ip: 60 }`, confirmed by response headers:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
X-RateLimit-Reset: 1786462320
Cache-Control: public, max-age=300
```

60 req/min/IP. Irrelevant at runtime — the corpus is baked at build time (CLAUDE.md §5.4) — but it
constrains the `corpus:sync` script to a handful of requests. It only needs 3.

---

## Counts

`/meta` reports, and full fetches confirm exactly:

| Source | `/meta` count | Actual items returned |
|--------|---------------|-----------------------|
| `shamail` | 120 | **120** |
| `seerah_timeline` | 34 | **34** |
| `courses_index` | 20 | **20** |

`limit=120` returns all 120 shamail in one request (`pages: 1`). `limit=500` clamps silently to 120.
Timeline is 34, not the ~50 CLAUDE.md assumed.

**The whole answer corpus is 154 entries, retrievable in exactly 2 requests.**

---

## Entry shapes

### Shamail

```jsonc
{
  "id": "672b3e8ed458540020750eab",        // 24-char hex ObjectId — a STRING, not an int
  "source": "shamail",
  "category": { "id": "1", "name": { "en": "...", "ur": "..." } },
  "slug": { "en": "...", "romanUrdu": "..." },
  "keywords": ["khulq", "moral", "akhlaq", ...],
  "en": {
    "title": "...",
    "hadeesTarjama": "...",   // the hadith translation — main body text
    "hadeesHawala": "...",    // source reference, e.g. "(صحیح بخاری حدیث 3560)"
    "type": "khulq",          // khulq (52) | khalq (68)
    "points": ["...", "..."], // lesson bullets
    "hikayat": "..."          // ONLY when include_hikayat=true
  },
  "ur": { /* same keys */ }
}
```

### Timeline

```jsonc
{
  "id": "6720dac1205912001e0bed87",
  "source": "seerah_timeline",
  "slug": { "en": "...", "romanUrdu": "..." },
  "en": {
    "title": "Blessed Birth",
    "description": "",                 // EMPTY on all 34 entries — dead field
    "section": "wiladat",
    "umarMubarak": 1,                  // age of the Prophet ﷺ
    "gregorianDate": 571,              // number; sometimes a range encoded as a float (576.577)
    "content": [                       // NESTED — not "plain text" as the brief implies
      { "title": "...", "sequence": 1, "content_text": "long prose, \\n-separated" }
    ]
  },
  "ur": { /* same keys */ }
}
```

### Courses (index only)

```jsonc
{
  "id": "...", "source": "courses_index",
  "slug": { "en": "...", "romanUrdu": "..." },
  "title": { "en": "...", "ur": "..." },        // note: flat title/description, NOT en{}/ur{} blocks
  "description": { "en": "...", "ur": "..." },
  "isLive": true, "isActive": false, "isFeatured": true
}
```

---

## Filters and params

| Param | Endpoint | Behaviour |
|-------|----------|-----------|
| `limit` | both | Works. Max 120; higher values clamp silently. |
| `page` | both | Works. `page=99` → `items: []`, `total` still 120. |
| `category_id` | shamail | Works. `category_id=1` → 17, `=6` → 32, `=99` → 0. |
| `section` | timeline | Works. `madni` → 11, `wiladat` → 1, `bogus` → 0. |
| `include_hikayat` | shamail | Works on **both** list and single-entry. Adds `en.hikayat` + `ur.hikayat` strings. |
| `q` | both | See below — narrower than it looks. |

### Shamail categories

| id | name (en) | count |
|----|-----------|-------|
| 1 | Characteristics of the Prophet ﷺ | 4 |
| 1 | Moral Qualities of the Beloved Prophet ﷺ | 13 |
| 2 | Personal Traits of the Beloved Prophet ﷺ | 29 |
| 3 | Physical Attributes of the Beloved Prophet ﷺ | 27 |
| 4 | Acts of Worship of the Holy Prophet ﷺ | 5 |
| 5 | Social Conduct of the Holy Prophet ﷺ | 10 |
| 6 | Daily Life of the Beloved Prophet ﷺ | 32 |

⚠️ **`category_id` 1 carries two different names.** Category ids are not a clean key — do not display
a category name derived from the id alone; read it off the entry.

### Timeline sections

`wiladat` (1), `childhood` (4), `larakpan` (6), `youth` (4), `nubuwat` (8), `madni` (11).

---

## `q=` — case-insensitive literal substring over a *limited field set*

Verified by picking terms whose exact location in the corpus was confirmed first, then querying:

| Query | Term lives in | Result |
|-------|---------------|--------|
| `revenge` | `en.title` | ✅ 1 hit |
| `sanctity` | `en.hadeesTarjama` **only** | ✅ 1 hit |
| `صبر` | `ur.title` **only** | ✅ 1 hit |
| `akhlaqy` | `keywords[]` **only** | ✅ 13 hits |
| `blasphemy` | `en.points[1]` **only** | ❌ **0 hits** |
| `intiqam` | `slug.romanUrdu` **only** | ❌ 0 hits |
| `Moral Qualities` | `category.name.en` **only** | ❌ 0 hits |
| `صحیح بخاری` | `ur.hadeesHawala` **only** | ❌ 0 hits |
| `Birth of Prophet` | timeline `content[0].title` **only** | ✅ 1 hit |
| `Khuraibah` | timeline `content[].content_text` **only** | ❌ **0 hits** |
| `Umm Ayman` | timeline `content[].content_text` **only** | ❌ 0 hits |

**Searched:** `title` (en+ur), `hadeesTarjama` (en+ur), `keywords[]`, and timeline `content[].title`.
**Not searched:** `points[]`, `content_text`, `slug`, `category.name`, `hadeesHawala`, `section`.

Matching semantics:
- **Substring, not word-boundary** — `reveng` matches "revenge"
- **Case-insensitive** — `REVENGE` matches
- **Exact literal, not tokenised** — `personal revenge` (a real substring) → 1 hit;
  `revenge blasphemy` (two words present in the same entry, not adjacent) → **0 hits**
- **No fuzzy matching** — `revengee` → 0 hits
- Trailing whitespace is trimmed

**Consequence: `q=` cannot find the actual prose.** The longest and most substantive text in the
corpus — timeline `content_text` and shamail `points[]` — is invisible to it. Server-side search is
not a viable retrieval mechanism for us. This *reinforces* the no-RAG decision (CLAUDE.md §4B): we
hold the corpus ourselves and never depend on `q=` at query time.

---

## Language — fully bilingual, parallel en/ur throughout

Every entry carries parallel `en` and `ur` blocks. Coverage across all 154 entries:

| Field | Shamail (n=120) | Timeline (n=34) |
|-------|-----------------|-----------------|
| `en.title` | 120/120 | 34/34 |
| `ur.title` | 120/120 | 34/34 |
| `en.hadeesTarjama` | 113/120 | — |
| `ur.hadeesTarjama` | 113/120 | — |
| `en.hadeesHawala` | 112/120 | — |
| `ur.hadeesHawala` | 119/120 | — |
| `points[]` non-empty | 50/120 (both langs) | — |
| `content[]` non-empty | — | 34/34 (both langs) |
| `en.description` | — | **0/34 — always empty** |

Scripts in play: **English prose**, **Urdu in Arabic script**, **Arabic phrases inline**
(`رضي الله عنها`, `صلى الله عليه وسلم`, `هٰذَا حَظُّ الشَّيْطَانِ مِنْكَ`), **the ﷺ glyph (U+FDFA)**, and
**roman-Urdu transliteration** in `slug.romanUrdu` and `keywords[]`.

Representative values:

```
en.title        : Sayyid al-Mursalin ﷺ never took personal revenge
ur.title        : حضور ر ﷺکا  ذاتی انتقام نہ لینا
slug.romanUrdu  : huzoor-ka-zaati-intiqam-na-lena
keywords        : ["khulq","moral","character","akhlaq","qualities","beloved","prophet","nby","pak","akhlaqy"]
ur.hadeesHawala : (صحیح بخاری حدیث 3560)
```

```
en.hadeesTarjama: It is narrated from Sayyidatuna Aisha رضي الله عنها that the Holy Prophet ﷺ never
                  took revenge for anything on his own behalf. However, if the sanctity of Allah was
                  violated, he would certainly seek retribution for it.
ur.hadeesTarjama: عائشہ رضی اللہ عنہا سے روایت ہے کہ حضورﷺ نے اپنی ذات کے لیے کبھی کسی سے بد لہ نہیں لیا ۔
```

`keywords[]` mixes English, roman-Urdu, and vowel-dropped transliteration (`nby` = nabi,
`akhlaqy` = akhlaqi) — usable as extra routing signal, not as display text.

**Implication for CLAUDE.md §7.1: Urdu support is cheap and well-supported.** The corpus already has
native Urdu for every entry — we are not translating anything, we are selecting a language block. This
is the strongest available differentiator relative to its cost.

---

## `/meta` — verbatim

### Disclaimer

**en:**
```
Answers must come only from this corpus. Cite every answer with source id and title. Do not invent Hadith, Quran, or Seerah text. Refuse fatwa/ruling questions and redirect to an alim.
```

**ur:**
```
جواب صرف اس ذخیرے سے آنا چاہیے۔ ہر جواب میں ماخذ آئی ڈی اور عنوان کا حوالہ دیں۔ خود سے حدیث، قرآن یا سیرت کا متن نہ لکھیں۔ فتویٰ / حکم والے سوالات رد کریں اور عالم کی طرف بھیجیں۔
```

⚠️ Note: this string is written **at the bot builder, not at the end user.** It is an instruction
sheet ("Cite every answer…", "Refuse fatwa questions…"), not a user-facing notice. Rendering it
verbatim in the chat UI as the persistent disclaimer would read as leaked system prompt.
See "Open decision" below.

### Usage rules

**en:**
```
1. Answer only from this corpus (Shamail + Seerah Timeline).
2. Cite every answer with source id and title (and hawala when available).
3. If the question is outside the corpus, say so and redirect.
4. Refuse fatwa/ruling questions and redirect to an alim.
5. Show a persistent disclaimer.
```

**ur:**
```
1. جواب صرف اس ذخیرے سے دیں (شمائل + سیرت ٹائم لائن).
2. ہر جواب میں ماخذ آئی ڈی اور عنوان کا حوالہ دیں (اور جہاں ممکن ہو حوالہ حدیث).
3. اگر سوال ذخیرے سے باہر ہو تو واضح کہیں اور ری ڈائریکٹ کریں.
4. فتویٰ / حکم والے سوالات رد کریں اور عالم کی طرف بھیجیں.
5. مستقل ڈس کلیمر دکھائیں.
```

Other `/meta` fields: `version: "1.0.0"`, `sources: ["shamail","seerah_timeline","courses_index"]`,
plus a `counts` block and an `endpoints` map confirming the base path.

---

## `include_hikayat=true`

Adds one key, `hikayat`, under **both** `en` and `ur`. It is a **long narrative string** (not an
array) — the extended story behind the entry. It nearly **quadruples** payload size:
205 KB → 781 KB across 120 entries. Roughly 1,300 chars/entry/language on average.

Example (`672b3e8e`, truncated):

> Sayyidatuna Aisha Siddiqa رضي الله عنها narrates that the Messenger of Allah صلى الله عليه وسلم
> never took revenge for anything concerning his own person… in the tenth year of prophethood, the
> Holy Prophet صلى الله عليه وسلم went to Ta'if to invite the tribe of Thaqif to Islam…

It is genuine extra grounding material, but it is the single biggest lever on context cost.

---

## Corpus size — LARGER THAN CLAUDE.md §4B ASSUMED

Text extracted from the JSON (excluding syntax overhead), counted per language.

Token figures are **estimates**, not tokeniser output: latin chars ÷ 4, Arabic-script chars ÷ 1.7
(Arabic script tokenises poorly). Treat as ±25%, and as a floor rather than a ceiling for Urdu.

| Slice | Chars | Est. tokens |
|-------|-------|-------------|
| Shamail, no hikayat, **en** | 59,916 | ~16,300 |
| Shamail, no hikayat, **ur** | 49,131 | ~24,700 |
| Shamail, **+hikayat**, en | 216,280 | ~58,600 |
| Shamail, **+hikayat**, ur | 277,590 | ~140,300 |
| Timeline, **en** | 113,361 | ~29,800 |
| Timeline, **ur** | 102,068 | ~51,700 |

Rolled up:

| Configuration | Est. tokens | Fits 200k window? |
|---------------|-------------|-------------------|
| **English only, no hikayat** | **~46,000** | ✅ comfortably |
| Urdu only, no hikayat | ~76,000 | ✅ |
| **Bilingual, no hikayat** | **~122,000** | ✅ but expensive per call |
| Bilingual, **+hikayat** | **~280,000** | ❌ **exceeds the window** |

CLAUDE.md §4B estimated "roughly 30–40k tokens total." The real figure is **~46k (English only)** to
**~280k (everything)**. §4B also says to stop and report if the corpus is dramatically larger — hence
this section.

### This does not overturn the no-RAG decision

A two-pass, no-embeddings approach keeps everything §4B wanted and costs far less than stuffing the
whole corpus into every call:

1. **Pass 1 — route.** Send a compact index of all 154 entries: `id | source | category/section |
   en.title | ur.title | keywords`. Measured: **33,738 chars ≈ 9,700 tokens, bilingual, complete.**
   The model returns candidate ids.
2. **Pass 2 — answer.** Send the full text of only those few entries, then validate the returned
   citations against the cached corpus per §5.3.

No vector DB, no embeddings, no chunking, no similarity thresholds — the whole index is in the prompt
and every id is checked in code. **This is a recommendation for Phase 2/3, not a decision taken.**

---

## Data quality notes

- **Ids are 24-char hex strings**, all 154 unique. CLAUDE.md §5.4 shows `"id": 47` in the response
  contract — that example is wrong and needs correcting before Phase 3.
- **Slugs are NOT unique** — 150 distinct slugs across 154 entries (e.g. `blessed-childhood` appears
  twice in the timeline). Cite by `id` only.
- **One entry is effectively empty:** `67824f4d53748aebf74997ab` ("The blessed tongue of the Prophet
  Muhammad ﷺ") has a title in both languages and **no body text in either**. It is citable but has
  nothing to say — the answer path must not treat "an entry exists" as "an entry has content."
- `timeline.description` is empty on all 34 entries.
- `gregorianDate` is a number, but ranges are encoded as floats — `576.577` means 576–577 CE. Do not
  render it raw.
- Two courses have empty English titles (Urdu-only).

---

## Resolved: the brief contradicts itself on courses — the API settles it

The brief says both:

- p1 / p3 Core Rules: *"grounded ONLY in the fixed corpus (Shamail 120 entries + **named course
  content**)"* / *"Bot answers only from approved Shamail + **course corpus**"*
- p3 asterisk: *"Answer corpus = Shamail + Timeline. Courses are index/reference only."*

The API is unambiguous, in two independent places:

- `/meta` → `usage_rules.en[0]`: **"Answer only from this corpus (Shamail + Seerah Timeline)."**
- `/courses` → `data.note.en`: **"Courses index only — titles and descriptions. Use Shamail +
  Timeline as the answer corpus."**

`/courses` returns only titles, descriptions and flags — **no course body content exists in the API to
answer from.** CLAUDE.md §4A is correct as written. No change needed.

---

## Open decision for Phase 4 — the disclaimer string

CLAUDE.md §4 says to use the `/meta` disclaimer **verbatim** because "the organizers wrote that field
and will look for it." But the string is addressed to the developer, not the user (see above).

Suggested resolution, for your call — do both, and lose nothing:
- render the `/meta` string verbatim in an "about / corpus rules" affordance so the judges find the
  exact text, and
- show a short user-facing persistent disclaimer in the chat surface, which is what
  `usage_rules[5]` ("Show a persistent disclaimer") actually asks for.

Not acting on this in Phase 0.
