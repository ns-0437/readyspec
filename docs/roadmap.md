# Roadmap: what to do next

Ordered by how much each item reduces the biggest uncertainty. The biggest one is simple: **nobody
has yet seen this run against a real model.** Everything else is secondary to that.

## 1. Validate the live path (needs `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` or `GROQ_API_KEY`) — do first

Steps and pass criteria: [live-validation.md](live-validation.md).

1. ✅ `npm run smoke:live` — **done for Gemini** 2026-09-22 (`gemini-3.6-flash`): full staged run
   passed after fixing three real schema bugs found from live 400s (docs/decisions.md 14).
   **Attempted for Groq** 2026-09-25 (`openai/gpt-oss-120b`): the single structured call passes
   cleanly, but the staged pipeline's `analyze` stage exceeds this account's free-tier throughput
   (8000 tokens/minute, account-wide) by a small margin — a real limit, not a code bug
   (docs/decisions.md 21). Not done for Anthropic (no key).
2. ✅ Run the demo ticket in the UI against the real model — **done for Gemini**: investigate through
   clarify worked correctly (specific questions, ignored the planted prompt-injection doc); the
   brief call then hit a real `429` quota limit, which the app handled correctly (recoverable,
   resumable, nothing lost). Not done for Groq (same throughput ceiling as step 1) or Anthropic.
3. `npm run eval -- --provider anthropic --set dev --repeat 3` (or `--provider gemini` /
   `--provider groq`) to see variance — **not yet run for any provider.** Gemini needs its quota to
   reset (or a paid tier); Groq needs either a smaller prompt footprint per call or its paid Dev
   Tier; Anthropic needs a key.
4. Human-score with [the rubric](../evals/rubrics/human-rubric.md), ideally blind and by someone else.
5. Freeze the code, run `--set heldout-v2` once (the only clean cohort left), and replace the "not measured" table in
   [evals/REPORT.md](../evals/REPORT.md) with real numbers, failures included.

Exit condition: a defensible answer to "does staged beat a single prompt on these cases, and by how much?"
including the possibility that it does not. Steps 1-2 are a necessary but far smaller precondition —
they show the pipeline *runs*, not that its output is *good*; steps 3-5 are what actually answers the question.

## 2. Fix whatever step 1 exposes

Likely suspects, in the order I would check them:

- **Prompt-following:** invalid JSON or schema failures (check the activity log for retry warnings).
- **Over-asking:** questions that the code already answers (raise the bar in `clarifyPrompt`).
- **Weak support:** observed claims that are true but name no identifiers, so they only score "weak".
- **Judge disagreement:** the optional model judge vs the lexical check vs a human on a sample.

## 3. Retrieval quality (no key needed, but mind the held-out set)

Current numbers: recall 97.1% dev (17 cases) / 100% clean held-out v2, precision 52.5% dev / 48% v2 (36% on
helpdesk-platform alone, the one repo bigger than the retrieval budget — see item 5); one dev miss is a
vocabulary gap. A dev-only sweep of cheap knobs moved precision about a point (decisions.md 13), so
further gains likely need model re-ranking. v2 predates test-pairing and the hop cap (decisions.md 16, 18)
and stays frozen.

- Precision: README down-weight is done (0.5, tiny gain); test-pairing is done (`maxTestPairs: 6`
  in `search.ts`, decisions.md 16) — a real context improvement for tickets that touch tested code,
  independent of ticket vocabulary, though it cost dev precision slightly on its own. Capping
  distractor-prone hops is done too (`maxHopsPerDefiner: 3`, decisions.md 18): one over-referenced
  symbol can no longer consume the whole second-hop budget before other definers get a turn.
  Together: distractors/case 0.71 -> 0.59, precision 52.4% -> 52.5%, recall unchanged (baseline
  updated). Both bullets in this item are now done; further gains likely need model re-ranking.
- Vocabulary gap: optional model query expansion as an explicit, disclosed extra call (a clarifying
  step, not a silent one). Embeddings only if this still leaves a gap.
- **Caveat:** held-out v1 is contaminated and v2 has been run once. Any further tuning contaminates v2;
  author a v3 cohort *before* tuning, and say so in the report.

## 4. Follow-up rounds that can look at new code — done

Implemented (decisions.md 10): answers that introduce new terms can pull in new excerpts, shown as "not yet sent"
and sent only after a second consent. Still to tune with a live model: whether the two-term threshold is right.

## 5. A benchmark that can actually separate the systems — partly done

The fixture side is done: `fixtures/repos/helpdesk-platform` (~30,800 characters, fictional, original)
exceeds the 24,000-character retrieval budget, with four dev-set cases against it (docs/decisions.md 15).
Confirmed deterministically: the single-prompt context note now reads "4 of 4 cases were truncated" —
every other repository has always read "0 of N". **What's still open:** this is one repository, and the
question the whole benchmark exists to answer — does staged actually produce a better brief than a
truncated single prompt — needs a live model run against it, which hasn't happened (see item 1/3). A
second larger fixture, or one pinned from a small real open-source project, would also help generalise
past a single data point.

## 6. Product polish

- ✅ Diff between brief revisions — partly done: `summarizeChanges()` in `src/shared/brief-edit.ts`
  shows what the current unsaved edit changed (added/removed/edited-in-place, by list) next to the
  "unsaved edits" banner (decisions.md 23). Still open: a real diff across *saved* revisions, which
  needs a persisted revision history that doesn't exist yet.
- Inline highlighting of the cited lines inside the excerpt when a claim or criterion is selected.
- ✅ Export a GitHub-issue-shaped Markdown variant — done: `exportGithubIssue()` in
  `src/server/workflow/export.ts` (`?format=issue`), task-list checkboxes for criteria/steps/tests,
  no evidence index (see decisions.md 17).
- ✅ Accessibility pass (focus order in the inspector, screen-reader labels on badges) — done:
  selecting a criterion now moves focus to the Traceability inspector (it used to appear in a
  separate column with no cue); the fixture-provider badge and completed-step checkmarks no
  longer read their decorative glyphs aloud (decisions.md 19). Still open: a full pass over the
  rest of the UI (dialogs, drag targets, color contrast) hasn't been done, just these two gaps.

## 7. Engineering hygiene

- Replace regex symbol extraction with tree-sitter for TS/JS/Python.
- Move snapshot creation off the request thread (worker) for large repositories.
- ✅ Dependabot, and a scheduled workflow that runs a deterministic retrieval-regression check —
  done: `.github/dependabot.yml`, `.github/workflows/retrieval-regression.yml`,
  `evals/runners/regression.ts` (`npm run eval:regression`). Checks retrieval only (recall,
  precision, distractor rate against `evals/baseline-retrieval.json`), since that's the
  deterministic, key-free part; it says nothing about clarification or brief quality.
- Move off `node:sqlite` if it stays experimental for long.

## Explicitly not next

Autonomous code changes, PR creation, Slack/Jira, org-wide indexing, reviewer routing and delivery
dashboards stay out of scope until step 1 shows the core loop is worth building on. No result here
supports any claim about company-wide time to market.
