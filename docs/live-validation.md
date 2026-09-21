# Live validation checklist

The Anthropic adapter is implemented and unit-tested against a mock server, but it has never
talked to the real API. Do this once, in order, and write down what you find.

## Setup

```bash
export ANTHROPIC_API_KEY=...            # PowerShell: $env:ANTHROPIC_API_KEY = "..."
export READYSPEC_MODEL=claude-sonnet-5  # optional
export READYSPEC_PRICE_IN_PER_MTOK=...  # optional: your model's price, so cost is computed
export READYSPEC_PRICE_OUT_PER_MTOK=...
```

The key stays server-side. It is never sent to the browser, never logged, and error text is redacted.

## 1. Smoke test

```bash
npm run smoke:live
```

Passes when: the structured call returns `answer = 4`, and the staged pipeline completes for the
demonstration ticket without error. It prints the questions, citation counts and verifier findings.

| If you see | Likely cause |
|---|---|
| `Model API returned 401` | Bad key |
| `Model API returned 404` | Wrong `READYSPEC_MODEL` id |
| `Model API returned 400: ... tool` | JSON Schema the API rejects (check `generate.ts` schema export) |
| `Model returned no structured result` | Forced tool call not honoured for this model |
| `gave up after 3 attempts (schema validation failed ...)` | Model output does not fit a stage schema; read the retry warnings |

## 2. UI run

`npm run dev`, open http://localhost:3000, run the demo ticket. Check:

- the banner no longer says "Fixture provider", and the consent screen says excerpts are sent to Anthropic
- the activity log shows real token counts (cost shows unless prices are unset)
- every observed claim's citations resolve and the badge says "supported by cited code" where it should
- the questions are specific to this repository, at most five, and not answered by the code
- deferred questions stay in "Open questions"; nothing you did not decide appears under "Decisions"
- **Cancel** during analysis works and **Resume** continues without repeating finished stages

## 3. Benchmark

```bash
npm run eval -- --provider anthropic --set dev --repeat 3
```

Roughly four calls per case per system pair, about 50 calls per run for the development set. Set
`READYSPEC_MAX_CALLS` high enough for one session, and check spend with your own prices first.

Outputs: `evals/results/anthropic-dev-latest.md`, a raw JSON per run, and
`human-scoring-sheet-dev.csv`. Fill the sheet using `evals/rubrics/human-rubric.md`.

## 4. Held-out set, once

Freeze the code. Then:

```bash
npm run eval -- --provider anthropic --set heldout
```

Do not tune against these results. If you must change the system afterwards, write new held-out
cases first and say so in the report.

## 5. Record the result

Update `evals/REPORT.md` and the status table in `README.md`. Keep the failures. Re-read the threats
to validity in [evaluation.md](evaluation.md) before writing any comparative claim.
