# Roadmap: what to do next

Ordered by how much each item reduces the biggest uncertainty. The biggest one is simple: **nobody
has yet seen this run against a real model.** Everything else is secondary to that.

## 1. Validate the live path (needs `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`) — do first

Steps and pass criteria: [live-validation.md](live-validation.md).

1. ✅ `npm run smoke:live` — **done for Gemini** 2026-09-22 (`gemini-3.6-flash`): full staged run
   passed after fixing three real schema bugs found from live 400s (docs/decisions.md 14). Not
   done for Anthropic (no key).
2. ✅ Run the demo ticket in the UI against the real model — **done for Gemini**: investigate through
   clarify worked correctly (specific questions, ignored the planted prompt-injection doc); the
   brief call then hit a real `429` quota limit, which the app handled correctly (recoverable,
   resumable, nothing lost). Not done for Anthropic.
3. `npm run eval -- --provider anthropic --set dev --repeat 3` (or `--provider gemini`) to see
   variance — **not yet run for either provider.** Needs the Gemini quota to reset (or a paid tier)
   before trying that provider again.
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

Current numbers: recall 96% dev / 100% clean held-out v2, precision 57% dev / 48% v2; one dev miss is a vocabulary gap. A dev-only sweep of cheap knobs moved precision about a point (decisions.md 13), so further gains likely need model re-ranking.

- Precision: README down-weight is done (0.5, tiny gain);
  pair each source file with its test; cap distractor-prone hops.
- Vocabulary gap: optional model query expansion as an explicit, disclosed extra call (a clarifying
  step, not a silent one). Embeddings only if this still leaves a gap.
- **Caveat:** held-out v1 is contaminated and v2 has been run once. Any further tuning contaminates v2;
  author a v3 cohort *before* tuning, and say so in the report.

## 4. Follow-up rounds that can look at new code — done

Implemented (decisions.md 10): answers that introduce new terms can pull in new excerpts, shown as "not yet sent"
and sent only after a second consent. Still to tune with a live model: whether the two-term threshold is right.

## 5. A benchmark that can actually separate the systems

On three tiny repositories a single prompt sees everything, so retrieval cannot help. Add one or two
repositories larger than the context budget (pinned commits of small open-source projects), write
cases against them, and rerun. This is where a staged workflow should either earn its complexity
or not.

## 6. Product polish

- Diff between brief revisions; show what an edit or a follow-up round changed.
- Inline highlighting of the cited lines inside the excerpt when a claim or criterion is selected.
- Export a GitHub-issue-shaped Markdown variant.
- Accessibility pass (focus order in the inspector, screen-reader labels on badges).
- Screenshots and a short recording in the README.

## 7. Engineering hygiene

- Replace regex symbol extraction with tree-sitter for TS/JS/Python.
- Move snapshot creation off the request thread (worker) for large repositories.
- Dependabot, and a scheduled workflow that runs the deterministic benchmark to catch retrieval regressions.
- Move off `node:sqlite` if it stays experimental for long.

## Explicitly not next

Autonomous code changes, PR creation, Slack/Jira, org-wide indexing, reviewer routing and delivery
dashboards stay out of scope until step 1 shows the core loop is worth building on. No result here
supports any claim about company-wide time to market.
