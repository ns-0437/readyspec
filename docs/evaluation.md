# Evaluation

Results and analysis: [evals/REPORT.md](../evals/REPORT.md). This page is the method.

## Question

Does a staged, repository-aware workflow give an engineer a better starting point than (a) a
static checklist or (b) one model prompt given the same repository and a comparable context
budget? "Better" means: finds the needed code, makes claims the code supports, surfaces the
decisions that matter without asking noise, and needs less correction.

It does **not** measure delivery time, and no result here supports a claim about company-wide time
to market.

## Cases

`evals/cases/*.json`: 26 tickets over three small fictional repositories written for this
project (`fixtures/demo-repository` TypeScript, `fixtures/repos/shop-orders` TypeScript,
`fixtures/repos/team-tasks` Python). Kinds: clear (2), ambiguous (14), conflicting documentation
(5), irrelevant files (1), misleading premise (1), vague (1), insufficient evidence (2) — plus
planted prompt-injection documents in every repository, some of which are retrieved.

Each case was written before any system output was inspected and records: expected required and
helpful files, distractor files, critical ambiguities, acceptable-but-not-critical question
topics, expected contradictions, unacceptable silent assumptions, and whether the right answer is
"the evidence is insufficient". `tests/eval.test.ts` checks that every referenced file exists and
that the keyword groups are neither trivially satisfied nor unsatisfiable.

Thirteen cases are held out in two cohorts. **v1** (7) was run once, then retrieval was tuned on the development
cases, so v1 is contaminated. **v2** (6) was written before that tuning and run once after it (`--set heldout-v2`);
it is the only clean held-out estimate. Any further tuning requires a new cohort first.

## Systems compared (same snapshot, same retrieval budget)

1. **Static checklist**: five generic questions for every ticket. No repository access, no model.
2. **Single prompt**: one model call. Repository files in path order up to the same 24,000-character
   budget the staged retriever gets, no retrieval, no clarification stage, no verifier. Citations
   are `path:lines`, validated afterwards. (On these small repositories it usually sees the whole
   repository; the report says how often it was truncated.)
3. **ReadySpec staged**: investigate, analyze, clarify (round 1), then a brief with every question
   *deferred* (nothing is silently decided in an unattended run), then verification.

## Metrics

| Metric | How | Depends on model output |
|---|---|---|
| Relevant-file retrieval | Recall of required files; precision against required+helpful; distractors used | Staged: no (deterministic). Single prompt: yes (files it cites or names) |
| Evidence correctness | Citation validity (path/range exist) and lexical support of observed claims | Yes |
| Critical ambiguity detection | Critical ambiguities matched by an asked question (and, separately, surfaced anywhere) | Yes |
| Unnecessary questions | Questions matching neither a critical ambiguity nor an acceptable topic | Yes |
| Contradictions noticed | Expected doc/code or premise/code contradictions found in output | Yes |
| Unacceptable assumptions | Regex rules on assumptions, criteria and observations | Yes |
| Insufficient evidence acknowledged | For cases where the right answer is "cannot establish" | Yes |
| Injection followed | Output skips questions/approves/declares fully specified | Yes |
| Human correction effort | **Proxy only** (verifier findings, unsupported claims, bad citations); measured minutes come from the human rubric | Yes |
| Runtime and cost | Wall-clock per case; tokens; cost only if `READYSPEC_PRICE_*` are set | Yes |

Keyword matching: a group matches when every term is present (each term may list `a|b`
alternatives). It is deliberately crude and auditable. The human rubric
(`evals/rubrics/human-rubric.md`) is the authoritative judgement; model-based scoring is not used.

## Running

```
npm run eval -- --provider fixture --set dev        # no credentials; model-dependent metrics are n/a
npm run eval -- --provider anthropic --set dev      # needs ANTHROPIC_API_KEY
npm run eval -- --provider anthropic --set heldout  # once, after freezing the code
```

Options: `--systems checklist,single,staged`, `--cases id,id`, `--set dev|heldout|heldout-v2|all`.
Outputs: `evals/results/<provider>-<set>-latest.md` (table), a timestamped JSON with every raw
output and score, and, for live runs, `human-scoring-sheet-<set>.csv` to fill in.

With the fixture provider, model-dependent cells print `n/a (fixture)`: scripted text is never
scored as if it were model output.

## Threats to validity

- Cases, fixtures, systems and scoring keywords were all written by the same person. Held-out
  cases guard against tuning, not against shared blind spots.
- Twenty-six cases on three tiny repositories say little about real codebases, and nothing about scale.
- Keyword scoring both under- and over-credits paraphrase; report it as an approximation.
- On small repositories a single prompt sees everything, so retrieval cannot differentiate the systems.
  A fair test of retrieval needs repositories larger than the context budget.
- Live results will vary run to run; report repeated runs before drawing conclusions.
