# Live validation checklist

Two model adapters are implemented and unit-tested against local mock servers, but neither has
ever talked to a real API. Do this once, per provider you care about, and write down what you find.

## Setup

Pick one provider (or run this whole checklist twice, once per provider — they are independent
code paths and a bug in one says nothing about the other).

```bash
# Anthropic
export ANTHROPIC_API_KEY=...             # PowerShell: $env:ANTHROPIC_API_KEY = "..."
export READYSPEC_MODEL=claude-sonnet-5   # optional

# Gemini
export GEMINI_API_KEY=...                # PowerShell: $env:GEMINI_API_KEY = "..."  (GOOGLE_API_KEY also works)
export READYSPEC_MODEL=gemini-2.5-flash  # optional

# Either way, optional: your model's price, so cost is computed instead of shown as unknown
export READYSPEC_PRICE_IN_PER_MTOK=...
export READYSPEC_PRICE_OUT_PER_MTOK=...
```

If both keys happen to be set, Anthropic is used unless you also set
`READYSPEC_PROVIDER=gemini`. The key stays server-side. It is never sent to the browser, never
logged, and error text is redacted.

## 1. Smoke test

```bash
npm run smoke:live
```

Passes when: the structured call returns `answer = 4`, and the staged pipeline completes for the
demonstration ticket without error. It prints the questions, citation counts and verifier findings.

| If you see | Likely cause |
|---|---|
| `Model API returned 401` | Bad key |
| `Model API returned 404` | Wrong `READYSPEC_MODEL` id for the provider you selected |
| (Anthropic) `Model API returned 400: ... tool` | JSON Schema the API rejects (check `generate.ts` schema export) |
| (Anthropic) `Model returned no structured result` | Forced tool call not honoured for this model |
| (Gemini) `Model API returned 400 ...responseSchema...` | `toGeminiSchema` in `gemini.ts` didn't strip something the API rejects — extend its `DROP` set |
| (Gemini) `Model returned no structured result (finishReason: MAX_TOKENS)` | Raise `maxOutputTokens` for that stage, or the model is stalling on the schema |
| (Gemini) `Model blocked the request: SAFETY` (or similar) | Content-safety filter tripped on the ticket or an excerpt; try a different ticket first to isolate it |
| `gave up after 3 attempts (schema validation failed ...)` | Model output does not fit a stage schema; read the retry warnings |

## 2. UI run

`npm run dev`, open http://localhost:3000, run the demo ticket. Check:

- the banner no longer says "Fixture provider", and the consent screen says excerpts are sent to the real provider
- the activity log shows real token counts (cost shows unless prices are unset)
- every observed claim's citations resolve and the badge says "supported by cited code" where it should
- the questions are specific to this repository, at most five, and not answered by the code
- deferred questions stay in "Open questions"; nothing you did not decide appears under "Decisions"
- **Cancel** during analysis works and **Resume** continues without repeating finished stages
- answering a question with text that names unrelated code (e.g. mention `invoiceTotal`) triggers
  the follow-up consent screen on the next round instead of silently pulling that code in

## 3. Benchmark

```bash
npm run eval -- --provider anthropic --set dev --repeat 3
# or
npm run eval -- --provider gemini --set dev --repeat 3
```

Roughly four calls per case per system pair, about 50 calls per run for the development set. Set
`READYSPEC_MAX_CALLS` high enough for one session, and check spend with your own prices first.

Outputs: `evals/results/<provider>-dev-latest.md`, a raw JSON per run, and
`human-scoring-sheet-dev.csv`. Fill the sheet using `evals/rubrics/human-rubric.md`.

## 4. Held-out set, once

Freeze the code first — **held-out v2 is the only clean cohort left** (v1 was already run once
before the retrieval tuning in `docs/decisions.md` item 13, so it no longer proves anything). Then:

```bash
npm run eval -- --provider anthropic --set heldout-v2
```

Do not tune against these results. If you must change the system afterwards, write a new held-out
cohort (v3) first and say so in the report.

## 5. Record the result

Update `evals/REPORT.md` and the status table in `README.md`, naming which provider(s) you
validated. Keep the failures. Re-read the threats to validity in [evaluation.md](evaluation.md)
before writing any comparative claim.
