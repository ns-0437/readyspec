# Evaluation report

Status: **partial.** No model credentials were available when this was originally written, so the
single-prompt baseline and every model-dependent metric of the staged workflow have **not been
measured**. That is still true of this document: everything below is from the fixture provider.

**Update 2026-09-22:** a Gemini key became available and was used to validate the live path itself
(`npm run smoke:live`, then a manual run through the real UI) — see [docs/decisions.md](../docs/decisions.md)
item 14. That confirms the pipeline works end to end against a real model (and fixed three real
schema bugs a mock-server test couldn't have caught), but it is **not** the benchmark: the actual
`npm run eval -- --provider gemini` run across the case set (needed to fill in the table below) has
not happened yet — it needs dozens of calls and the key had already hit its free-tier quota during
the UI validation. Do not read "the live path works" as "the numbers below are validated"; they
still are not. Method: [docs/evaluation.md](../docs/evaluation.md).

Run: 2026-09-21, fixture provider (no language model), `npm run eval -- --provider fixture`.
26 cases in three groups: **development** (13, used to tune retrieval), **held-out v1** (7, run once before the
tuning below, so no longer clean) and **held-out v2** (6, written before the tuning and run once after it).

## What was measured (real, deterministic)

### Retrieval of the required files: ReadySpec staged workflow

| Set | Cases | Required-file recall | Precision (required + helpful) | Distractor files / case |
|---|---|---|---|---|
| Development | 13 | 96% | 57% | 0.54 |
| Held-out v1 (contaminated: rerun after tuning) | 7 | 100% | 59% | 0.57 |
| **Held-out v2 (clean, run once)** | 6 | 100% | **48%** | 0.67 |

Per case, only one required file was missed in 26 cases: `src/api/routes.ts` for
`demo-05-admin-skipped-log` ("Let admins see which notifications were skipped..."). The ticket shares
no vocabulary with that file; lexical retrieval cannot find it. Every other required file was retrieved.

### Static-checklist baseline (five generic questions for every ticket)

| Set | Critical ambiguities asked | Unnecessary-question rate | Expected contradictions noticed | Required-file recall |
|---|---|---|---|---|
| Development | 3% | 98% | 0% | 0% (does not read the repository) |
| Held-out v1 | 0% | 100% | 0% | 0% |
| Held-out v2 | 0% | 100% | not scored here | 0% |

A generic checklist is not a strawman by construction: it asks reasonable questions. It scores
near zero because those questions are not specific to any ticket, which is the point of the
comparison and also the limit of what this row shows. The keyword groups were checked to ensure
this is not an artefact of over-strict matching: specific questions do match them (calibration
test in `tests/eval.test.ts`).

## What was not measured

| Metric | Single prompt | ReadySpec staged | Reason |
|---|---|---|---|
| Evidence correctness (citation validity, support) | not run | not run | needs a live model |
| Critical ambiguity detection | not run | not run | needs a live model |
| Unnecessary questions | not run | not run | needs a live model |
| Contradictions / insufficient evidence / injection | not run | not run | needs a live model |
| Human correction effort | not run | not run | needs a live model and human scoring |
| Latency and cost | not run | not run | needs a live model |

The claim "ReadySpec resolves ambiguity better than a single prompt" is therefore **unsupported
by any measurement in this repository.** The product hypothesis is unproven; the harness to test
it exists.

## Other evidence that the system does what it claims (tests, not benchmark)

These are engineering tests (156 in `tests/`), not model-quality evidence:

- Snapshots exclude secrets, binaries, generated and oversized files, never follow symlinks or
  junctions, and pin content by hash. Traversal and out-of-root paths are rejected.
- The verifier rejects, with specific codes: unknown or tampered citations, observed claims with no
  evidence, observed claims naming code the citation does not contain, criteria without tests,
  dangling references, invented or altered decisions, deferred questions presented as decided, and
  dropped unresolved questions. A valid citation is shown to be insufficient on its own.
- No model call happens before consent; only disclosed excerpts appear in prompts; excluded files'
  contents never reach a prompt; repository text is fenced and the planted injection is flagged and
  ignored (the injection document is retrieved for the demonstration ticket and the session still
  asks its questions and does not approve).
- Cancellation, transient provider failure, budget exhaustion and provider change are handled and
  recoverable, with answers and evidence preserved.

## Known weaknesses (failures, not spin)

1. **Precision is low, and lower on clean data** (dev 57%, clean held-out v2 48%). The gap is the honest generalisation estimate; the dev number is optimistic.
   A dev-only sweep of README down-weighting, per-file caps, minimum item count and hop cap moved precision by about a point
   (README weight 0.5 kept: 56% to 57%); disabling the reference/definition hops raised precision to 62% but cut recall from 96% to 87%, so they stay.
   Cheap knobs are exhausted; real gains probably need model re-ranking, which needs a key.
   Original note: Retrieval favours recall (`minItems: 6` raised recall from 92% to
   96% on the dev set and cost 5 points of precision). About half the excerpts sent to a model are
   not required or helpful for the ticket, which costs tokens and gives an injection-bearing
   document more chances to be included.
2. **Vocabulary gap.** The one missed required file is a pure vocabulary mismatch. Lexical retrieval
   will keep missing files that a ticket describes in different words than the code uses.
3. **Distractors get through** (0.54-0.57 per case), e.g. `taskboard/search.py` and `export.py` for a
   "snooze reminders" ticket, `src/reports/sales-report.ts` for refund tickets.
4. **Recall of 100% on the held-out set is a small-sample result** (7 cases, 3 tiny repositories) by a
   system whose author also wrote the cases. It should not be read as a general recall estimate.
5. **The support check is lexical.** It catches invented identifiers, not wrong meaning.
6. **The static-checklist row does not test the interesting comparison.** The interesting one is
   single prompt vs staged, and it is missing.

## To complete this report

1. Set `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` (optionally `READYSPEC_MODEL`, `READYSPEC_PRICE_IN_PER_MTOK`,
   `READYSPEC_PRICE_OUT_PER_MTOK`).
2. `npm run eval -- --provider anthropic --set dev` (or `--provider gemini`), repeat a few times to see variance.
3. Freeze the code; run `--set heldout-v2` once (the only clean cohort left).
4. Fill the generated `human-scoring-sheet-*.csv` using `evals/rubrics/human-rubric.md`, ideally
   blind and by someone other than the author.
5. Replace this "not measured" table with the results, keep the failures, and re-read
   `docs/evaluation.md` threats to validity before claiming anything.

A live run is roughly four model calls per case per system pair (three staged, one single prompt):
about 50 calls for the development set. Check cost with your own prices before running.
