# Recorded provider responses

**Committed on purpose.** Small JSON, nothing secret (the corpus is public), and committing them means the adversarial suite runs in CI at zero quota (§5.6).

Each file is the **entire raw response envelope** — `finishReason`, `safetyRatings`, `promptFeedback`, `usageMetadata` — not just the text. We need fixtures for the *failure* paths, not only the happy one, and a blocked-by-safety response is not something you can conjure from a live API on demand.

## Replaying (the default, always)

Nothing to do. `FIXTURES` unset means replay-only, and **a missing fixture throws `MissingFixtureError` rather than falling through to a live call** — a silent fallthrough is how a "free" test run quietly spends 40 requests.

## Recording (deliberate, costs quota)

1. Set `FIXTURES=record` in `.env`
2. Run the specific thing you want recorded — not the whole suite
3. **Remove `FIXTURES=record` again**
4. Commit the new fixtures

## Invalidation

Automatic. `PROMPT_VERSION` and `SCHEMA_VERSION` (`api/src/prompts.ts`) are part of the key, along with the provider and model. Editing a prompt turns every affected fixture into a **loud miss**, not a silent replay of the previous prompt's behaviour.

**Keep old fixtures.** They are small, and a diff of router behaviour across prompt versions on the same hostile questions is worth showing at judging.

## Key

`sha256(op + provider + model + PROMPT_VERSION + SCHEMA_VERSION + language + normalised question)`, truncated to 32 hex chars. The question is NFC-normalised and whitespace-collapsed, so trivially different spellings of the same question share a fixture.
