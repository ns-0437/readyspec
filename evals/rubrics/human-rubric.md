# Human scoring rubric

Keyword matching in the runner is a rough proxy. This rubric is the authoritative judgement.
Score each (case, system) output blind to which system produced it where possible. Record in
`scoring-sheet.csv` inside that run's own directory, `evals/results/runs/<provider>-<set>-<timestamp>-<id>/`.
A live run creates it once, before the first request, and never overwrites it; fixture runs produce none.

**Sheet columns:** `repetition, case_id, system, output_file, held_out, brief_usable_as_is(0-2),
critical_gaps_missed(count), wrong_or_unsupported_claims(count), unnecessary_questions(count),
silent_policy_decisions(count), minutes_to_make_usable, reviewer, notes`. The first five are filled; you
fill the rest. The six score columns follow items 1-6 below, in order. Sheets generated before the
`silent_policy_decisions` column existed are never rewritten: record that count in their `notes`.

**Finding the output for a row:** `output_file` is a path relative to the same run directory, shaped
`results/rep<repetition>/<case_id>__<system>.json`. Open it and read `output` (questions, observations
with their cited evidence, criteria, assumptions). Do not use its `score` block if scoring blind: it holds
the automatic keyword scores. Check `status`: `budget_exhausted` files are partial and unscored, and a row
whose file does not exist was never run (see `run-accounting.json`), so leave it blank. `system` and the file
name reveal which system produced the output; for blind scoring, work from a copy of the sheet with that
column hidden and rows shuffled, and keep the original to map results back.

Use the case file (`evals/cases/<id>.json`) as the answer key: `expectedFiles`,
`criticalAmbiguities`, `expectedContradictions`, `unacceptableAssumptions`.

## Per output

**1. Usable as is (0-2)**
- 2: an engineer could start implementing after a short read; nothing important is wrong or missing
- 1: usable after edits that take a few minutes
- 0: would mislead, or the effort to fix exceeds writing it from scratch

**2. Critical gaps missed (count)**
Critical ambiguities from the case file that the output neither asks about nor lists as open.
A vague question ("any edge cases?") does not count as covering a specific ambiguity.

**3. Wrong or unsupported claims (count)**
Statements about existing behavior that the cited code does not support, that contradict the
code, or that accept a documentation claim the code disproves. Open each citation and read the
lines. A citation that exists but does not show the claim counts here.

**4. Unnecessary questions (count)**
Questions whose answer would not change behavior, scope or testing, or that the code/docs already
answer, or that duplicate another question.

**5. Silent policy decisions (count)**
Any assumption, criterion or decision that picks a product policy the case lists as
unacceptable, or that resolves an open decision without the human.

**6. Minutes to make usable**
Time for a reviewer to edit the brief into something they would approve. Stop at 15.

## Aggregation

For repeated runs, average each metric across repetitions within a case and system first, then
average those per-case values so cases with more completed repetitions do not get extra weight.
Report the number of distinct cases and completed outputs per system, along with the repetition
count. Keep development and held-out results separate. Report every case where a system scored 0
on "usable as is", and list missing or partial outputs rather than silently dropping them.

## Calibration

Before scoring, two reviewers independently score three outputs and compare. Disagreement of more
than one point on "usable as is" means the case file needs a clearer answer key.
