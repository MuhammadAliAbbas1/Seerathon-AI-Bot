# Screenshots for the README and the submission

⚠️ **The root README links two of these inline. Add them before making the repo public, or delete that block** — a broken image is the first thing a judge would see.

These ARE tracked in git, unlike `docs/design-reference/` (screenshots of the organizers' own app, which are gitignored — see CLAUDE.md §12.7). These are our own product.

## Needed by the README

| File | What must be on screen |
|---|---|
| `01-answer.png` | An in-corpus answer in **English** with the source card open — the question, the answer in the bot's own words, the citation chip, and the card showing entry title, verbatim hadith text, hawala reference and the 24-char entry id |
| `02-ruling.png` | **"Is it sunnah to eat with the right hand?"** → the scholar redirect. The hard case: the corpus covers this topic, so a naive bot answers it |

## The full submission set, in upload order

The feed shows assets as "View image" links rather than thumbnails, so **image 1 has to earn the second click** — it leads with the product working, not with an empty screen.

1. `01-answer.png` — as above. Proves the core loop, and shows the citation is a real entry with a real id
2. `03-landing.png` — the landing screen, English, all four chips and the disclaimer bar. The guardrails as a table of contents, and the only frame showing the persistent disclaimer
3. `02-ruling.png` — as above
4. `04-urdu.png` — the same question as image 1, in Urdu, with the Urdu source card. Placed after it, this reads as *one question, two languages, same corpus*
5. `05-out-of-corpus.png` — the cryptocurrency question declined. Completes the four rubric behaviours, and shows the refusal is calm — no red, no error iconography
6. `06-about.png` — the About / Corpus Rules screen showing the **verbatim** organizer-published disclaimer and the five usage rules

Optional 7th: a terminal capture of `npm run check` — 154 tests passing plus the drift checks. Evidence of the half a judge cannot otherwise see.
