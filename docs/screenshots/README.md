# Screenshots for the README and the submission

⚠️ **The root README links three of these inline — `01-answer`, `07-sources`, `02-ruling`, in that order.** All seven are present as of 2026-08-25. If any is ever renamed or removed, fix the README in the same commit: **a broken image is a judge's first sight of the repo.**

⚠️ **They are `.jpeg`, not `.png`.** Every reference in this file and in the root README was written as `.png` before the files existed, and every one of them was broken. Converting to PNG was rejected — these are already lossy, so a re-encode inflates the file without recovering anything. **Match the extension on disk; do not assume it.**

These ARE tracked in git, unlike `docs/design-reference/` (screenshots of the organizers' own app, which are gitignored — see CLAUDE.md §12.7). These are our own product.

## Needed by the README

| File | What must be on screen |
|---|---|
| `01-answer.jpeg` | An in-corpus answer in **English**, sheet CLOSED — the question, the answer in the bot's own words, and the citation chip stating the source count. The complete loop plus visible evidence it has receipts |
| `07-sources.jpeg` | The source card for that same answer — entry title, verbatim hadith text, hawala reference, and the **24-char entry id**. The strongest single piece of evidence in the repo: it is what turns "citations are validated" from a claim into a checkable record |
| `02-ruling.jpeg` | **"Is it sunnah to eat with the right hand?"** → the scholar redirect. The hard case: the corpus covers this topic, so a naive bot answers it |

### ⚠️ The sheet fully occludes the answer — this is why 01 and 07 are separate

The sources sheet **opens fully or not at all**; there is no partial-scroll state that shows the answer behind it. So a single frame cannot carry both the answer and the source card, and the sheet-open frame alone shows **a citation with nothing cited** — a source card floating above an answer the judge cannot see, which is the opposite of the claim being made.

Split accordingly: **`01-answer.jpeg` proves the loop, `07-sources.jpeg` produces the receipts.** The 24-char entry id — the thing that makes "citations are validated" checkable rather than asserted — lives in 07, not 01.

🚫 **Do not merge these back into one frame.** It has been tried; the sheet's occlusion is a property of the component, not a capture mistake.

## The full submission set, in upload order

The feed shows assets as "View image" links rather than thumbnails, so **image 1 has to earn the second click** — it leads with the product working, not with an empty screen.

1. `01-answer.jpeg` — as above. The core loop, end to end, in one frame
2. `07-sources.jpeg` — the source card for that same answer: entry title, verbatim hadith text, hawala reference, and the **24-char entry id**. Immediately after 01 so it reads as *here is the proof for what you just saw*
3. `03-landing.jpeg` — the landing screen, English, all four chips and the disclaimer bar. The guardrails as a table of contents, and the only frame showing the persistent disclaimer
4. `02-ruling.jpeg` — as above
5. `04-urdu.jpeg` — **the same question and the same framing as image 1**, in Urdu: answer screen, sheet closed, citation chip visible. Mirroring 01 is the point — it reads as *one question, two languages, same corpus*, which only works if the two frames are comparable
6. `05-out-of-corpus.jpeg` — the cryptocurrency question declined. Completes the four rubric behaviours, and shows the refusal is calm — no red, no error iconography
7. `06-about.jpeg` — the About / Corpus Rules screen showing the **verbatim** organizer-published disclaimer and the five usage rules

⚠️ **Position 3 is where the persistent disclaimer first appears**, one slot later than before the 07 split. If assets get truncated in the feed, that is the frame to protect — it is the only one showing a rubric item that is otherwise invisible in stills.

Optional 8th: a terminal capture of `npm run check` — 154 tests passing plus the drift checks. Evidence of the half a judge cannot otherwise see.
