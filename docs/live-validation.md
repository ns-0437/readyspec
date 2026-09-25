# Live validation checklist

Three model adapters exist. **Gemini (`gemini-3.6-flash`) was validated live on 2026-09-22** — steps
1 and 2 below both passed; three real schema bugs were found and fixed along the way (see
`docs/decisions.md` item 14; the "If you see" table below still documents them for future models).
**Groq (`openai/gpt-oss-120b`) was live-tested on 2026-09-25**: step 1's single structured call
passes, but the staged pipeline's first real stage (`analyze`, ~6000 reserved completion tokens
plus prompt tokens) exceeds this account's free-tier throughput cap (8000 tokens/minute, shared
account-wide across models — confirmed with both `openai/gpt-oss-120b` and `openai/gpt-oss-20b`,
same limit) by a small margin; see `docs/decisions.md` item 21. **Anthropic has never talked to a
real API** (no key) and is still mock-server-only. Redo this checklist for a new model id, or for
Anthropic, and write down what you find.

## Setup

Pick one provider (or run this whole checklist multiple times, once per provider — they are
independent code paths and a bug in one says nothing about the others).

```bash
# Anthropic
export ANTHROPIC_API_KEY=...             # PowerShell: $env:ANTHROPIC_API_KEY = "..."
export READYSPEC_MODEL=claude-sonnet-5   # optional

# Gemini
export GEMINI_API_KEY=...                # PowerShell: $env:GEMINI_API_KEY = "..."  (GOOGLE_API_KEY also works)
export READYSPEC_MODEL=gemini-3.6-flash  # optional

# Groq (free tier, no card: https://console.groq.com/keys)
export GROQ_API_KEY=...                     # PowerShell: $env:GROQ_API_KEY = "..."
export READYSPEC_MODEL=openai/gpt-oss-120b  # optional

# Either way, optional: your model's price, so cost is computed instead of shown as unknown
export READYSPEC_PRICE_IN_PER_MTOK=...
export READYSPEC_PRICE_OUT_PER_MTOK=...
```

If more than one key is set, priority is Anthropic > Gemini > Groq unless you also set
`READYSPEC_PROVIDER=anthropic|gemini|groq` explicitly (needed if, say, a Gemini key is set but its
quota is exhausted and you want to force Groq). The key stays server-side. It is never sent to the
browser, never logged, and error text is redacted.

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
| (Gemini) `400 ... Unknown name "X" ... Cannot find field` | A JSON Schema keyword the live API rejects by that exact name — add `X` to `toGeminiSchema`'s `DROP` set in `gemini.ts` (three were found and fixed this way: `propertyNames`, `additionalProperties`, `const`) |
| (Gemini) `400 ... "type" ... Proto field is not repeating, cannot start list` | A `.nullable()` field rendered as `"type": ["string","null"]`; already translated to `{type, nullable:true}` in `toGeminiSchema` — if you see this again, a new schema shape needs the same treatment |
| (Gemini) `finishReason: MAX_TOKENS` with no text at all | A reasoning model burned the whole `maxOutputTokens` budget on hidden "thinking" tokens before writing the answer; already fixed with `thinkingConfig: {thinkingBudget: 0}` — if you still see this, that stage's budget may just be too small |
| (Gemini) `429 ... exceeded your current quota` | Free-tier rate/quota limit, not a code bug; the session fails as **recoverable** with decisions and evidence kept — wait for the quota to reset (often per-minute or per-day) and click **Resume**, or check https://ai.google.dev/gemini-api/docs/rate-limits |
| (Anthropic) `Model API returned 400: ... tool` | JSON Schema the API rejects (check `generate.ts` schema export) |
| (Anthropic) `Model returned no structured result` | Forced tool call not honoured for this model |
| (Groq) `429 ... tokens per minute (TPM)` | Free-tier throughput limit; `generate.ts` now honours the `retry-after` header Groq sends (docs/decisions.md 21), so a single slow-down usually self-heals on retry |
| (Groq) `413 ... Request too large ... TPM` | The single request's prompt + reserved completion tokens already exceed the whole per-minute budget (8000 tokens on this account) — no retry helps; confirmed live with both `openai/gpt-oss-120b` and `openai/gpt-oss-20b` on the `analyze` stage against even the small demo repo. Not a code bug: a real free-tier ceiling. A smaller ticket/repo, a paid Dev Tier (linked in the error message), or a different account may fit |
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
# or
npm run eval -- --provider groq --set dev --repeat 3
```

**Not yet run for either provider** (see `evals/REPORT.md`). Roughly four calls per case per system
pair, about 50 calls per run for the development set — comfortably enough to exhaust a free-tier
quota in one run (it happened during step 2's manual UI check, on far fewer calls). Set
`READYSPEC_MAX_CALLS` high enough for one session, and check spend/quota with your own plan first.

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
