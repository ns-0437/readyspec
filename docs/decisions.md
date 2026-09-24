# Decisions

Short records of choices that would be expensive to rediscover. Newest last.

## 1. Staged workflow, not multiple agents
Six named stages with typed hand-offs. Three of them are plain code. Nothing here needs agents
negotiating; a stage that fails can be retried on its own. Revisit only if evaluations show a
stage cannot be done well in one call.

## 2. `node:sqlite` instead of `better-sqlite3`
Built into Node >= 22.13, so no native build step on Windows. Loaded through
`process.getBuiltinModule` so Next's bundler never resolves it. Cost: emits an experimental
warning; requires a recent Node.

## 3. Anthropic via `fetch`, structured output via a forced tool call
One fewer dependency and full control over headers, timeouts and error text. The stage's JSON
Schema (from Zod) is the tool's `input_schema`. **Not validated against the live API** (no
credentials were available); covered by a mock-server test of request shape, response parsing,
error classification and key redaction.

## 4. Lexical + symbol-aware retrieval; no embeddings
BM25 over symbol-aligned chunks (symbol and path tokens boosted), a small synonym table, and
one-hop expansion in both directions (chunks that reference a hit's symbol; definitions of
identifiers a hit uses). Measured on the 13 development cases (fixture run, deterministic):

| Config | Required-file recall | Precision | Distractors / case |
|---|---|---|---|
| Relevance cutoff only | 92% | 61% | 0.46 |
| + keep at least 6 chunks (`minItems`) | 96% | 56% | 0.54 |

Chose recall: this stage feeds a model that judges relevance, and a missed file is worse than an
extra one. The change was made after inspecting two dev-set misses (a rare-term chunk starved
everything else). Remaining dev miss: `demo-05` never retrieves `src/api/routes.ts` because the
ticket shares no vocabulary with it. Embeddings stay off the table until a live run shows
retrieval, not reasoning, is the bottleneck.

## 5. Disclosure and explicit consent before any model call
The user sees each excerpt (path, lines, size, injection flags) and the estimated tokens, and
must consent. Cheap to build, and it makes "what is sent" a fact rather than a promise.
The fixture provider follows the same flow so the behavior is identical.

## 6. Human answers are authoritative; the application repairs the brief
After generation the service rebuilds `decisions` from what the human recorded, re-adds any
unresolved question the model dropped, and removes open questions that were answered. Each repair
is logged. The verifier independently rejects a brief that violates these rules (for edits and
for evaluation of raw output).

## 7. Approval gate is deterministic
Approval needs: a named reviewer, passing verification for the *current* revision, and an explicit
acknowledgement of unresolved items. Model-judge verdicts are supplementary and never gate.
Editing an approved brief clears the approval.

## 8. Support check is lexical, and says so
A claim that names identifiers absent from its cited lines is flagged; a claim in plain English
with no identifiers gets "weak", not "supported". This catches invented code and wrong citations
and is cheap, deterministic and testable. It cannot catch a wrong interpretation of real code.
That gap is why the evaluation includes a human rubric.

## 9. Fixture provider is a first-class, always-labelled provider
It lets the whole product, the verifier and the evaluation plumbing run without credentials. It is
scripted for the demonstration ticket and mechanical elsewhere. It is labelled in the UI, brief
provenance, exports and reports, and evaluation metrics that depend on model output are reported
as n/a rather than computed from scripted text.

## 10. Follow-up rounds can pull in new code, but only with new consent
First version reused the original excerpts. Now a follow-up re-runs retrieval over the ticket plus the human's answers and keeps only excerpts that (a) are not already known and (b) match at least two words the answers introduced
(so loosely related chunks do not force a consent step every round). If any remain, the session returns to
`awaiting_consent` with a disclosure that lists only the new excerpts (`scope: followup`); they are shown in the explorer
as "not yet sent" and no model call happens until the user accepts or skips them. Evidence ids stay stable and the
disclosure is rebuilt for the whole set afterwards. Cost: one extra click when answers name new code.

## 11. UI was built after the backend, against the real API
The plan called for a fixture-data interface in milestone 1. It was faster and less wasteful to
build the backend first and drive the real interface with the fixture provider, which is also
what the demo uses. There is no separate mock UI.

## 12. Evaluation design
Thirty hand-authored cases over four small repositories (a fourth, larger one added in 15); thirteen are held out in two cohorts (see 13; run once, after
code freeze). Ambiguity/assumption/contradiction scoring uses keyword groups: deterministic and
auditable but crude. Calibration tests check the groups are not trivially satisfied (the generic
checklist scores about 3%) and are satisfiable (natural specific questions score >= 80%). The
human rubric is authoritative. See `docs/evaluation.md`.

## 13. Retrieval tuning stopped at cheap knobs; held-out cohorts
After the first held-out run, six new held-out cases (cohort v2) were written *before* touching retrieval, so v1 is
declared contaminated and v2 is the clean estimate. A dev-only sweep (README down-weight, per-file cap, minimum items,
hop cap) moved precision by about one point; only the README down-weight (0.5) was kept. Disabling the reference and
definition hops raised dev precision to 62% but cut recall from 96% to 87%, so they stay. Clean v2 result: recall 100%,
precision 48% (dev 57%), i.e. the dev number was optimistic. Further gains likely need model re-ranking, which needs a key.

## 14. A second provider (Gemini), added because a key became available for it before Anthropic
`GeminiProvider` mirrors `AnthropicProvider`: same `LlmProvider` interface, `fetch`-only, same error
classification (429/5xx retryable, other 4xx not, malformed/empty response is a `ProviderError`,
caller abort maps to `CancelledError`), same key-redaction discipline. The structured-output
mechanism differs: Gemini has no "forced tool call" primitive, so it uses
`generationConfig.responseMimeType: "application/json"` with a `responseSchema` derived from the
same Zod-generated JSON Schema Anthropic gets as a tool's `input_schema`. Gemini's schema support
is a restricted OpenAPI-3.0 subset, not full JSON Schema, so `toGeminiSchema` strips or translates
keywords it rejects. `createProvider()` treats the two providers symmetrically: an explicit
`READYSPEC_PROVIDER` always wins and errors loudly if that provider's key is missing (never a
silent fallback); with no explicit choice, Anthropic is preferred when both keys are set, purely so
the selection is a fixed, documented rule rather than "whichever env var happens to be read first".

**Update, same day: validated live against `gemini-3.6-flash` (Anthropic still untested — no key).**
The first three attempts each failed with a different, specific 400 from the real API, none of
which the mock-server tests (built from documentation-level guesses, not real responses) had
caught — a direct demonstration of why "not validated against the live API" was in the status table
in the first place. Each was fixed from the exact error message, not guessed, then re-tested live:
1. `Unknown name "propertyNames" ... Cannot find field` — Zod's `z.record` (`evidenceNotes`) emits
   `propertyNames`; Gemini's schema doesn't have it. Dropped.
2. `Unknown name "additionalProperties" ... Cannot find field` — also from `z.record`, and also
   unsupported (reverses the original guess that it was needed and accepted). Dropped; a
   `z.record`-typed field degrades to an untyped `{"type":"object"}` for this provider only.
3. `Unknown name "type" ... Proto field is not repeating, cannot start list` — Zod renders
   `.nullable()` as JSON Schema 2020-12's `"type": ["string","null"]`; Gemini's Schema proto wants
   a single scalar `type` and a separate `nullable: true`. Now translated.
4. Separately (not an error, a silent failure mode): `gemini-3.6-flash` is a reasoning model that
   spends hidden "thinking" tokens out of the same `maxOutputTokens` budget before writing the
   answer. At a stage-sized budget it burned the whole budget thinking and returned
   `finishReason: MAX_TOKENS` with no text at all — `extractJson` correctly saw this as "no JSON
   found" and retried, but every retry would have failed the same way. Fixed by sending
   `thinkingConfig: { thinkingBudget: 0 }`; the tests and code both explain why.

With all four fixed, `npm run smoke:live` completed the full staged pipeline (analyze, clarify,
brief, verify) end to end, 3 calls, 0 invalid citations, and it correctly identified the
`docs/notifications.md` vs `decideDelivery` contradiction that's built into the demo fixture. A
second run driven through the actual browser UI (not the CLI script) got through investigate,
disclosure, consent, analyze and clarify — the questions were specific to the code (not generic),
and the model did not follow the planted `docs/AGENT_NOTES.md` prompt-injection text — then hit a
real `429` quota-exceeded on the brief call (the account's free-tier limit, not a code defect);
the app classified it as recoverable, kept all 3 decisions and 17 evidence items, and offered
**Resume**, exactly as designed. This is real evidence the reliability machinery
(retry/backoff/recoverable-failure/resume) works under a genuine live failure, not just a
scripted mock. **What this does not yet cover:** the model-dependent benchmark (`npm run eval`)
has not been run — that's dozens of calls and would need the quota to reset first — and Anthropic
remains completely unvalidated. See `evals/REPORT.md`.

## 15. A fourth fixture (helpdesk-platform) sized to actually exceed the retrieval budget
Every case run so far, including the live Gemini one, carried a footnote: "single-prompt baseline saw the whole
repository (0 of N cases truncated), so retrieval gives ReadySpec no advantage on small repositories." The three
original fixtures are 6-11K characters; the retrieval budget is 24,000. `fixtures/repos/helpdesk-platform`
(IT ticketing: tickets, agents, SLA clock, routing, macros, KB, notifications, surveys, audit log, custom fields;
~30,800 characters) was sized specifically to cross that line, with four new dev-set cases against it. Confirmed
live (fixture provider, deterministic): the single-prompt context report now reads "4 of 4 cases were truncated,"
the first time that number has been anything but zero. Staged retrieval on it: 100% required-file recall, 36%
precision (down from 48-57% on the smaller repos, as expected on a larger, more varied codebase), 1.25
distractors/case. This does not yet answer whether staged actually beats a truncated single prompt in practice
(still needs a live model run), but the benchmark can now, for the first time, actually pose that question.

While building the fixture, also fixed a real bug this exposed: `aggregate()` in `evals/runners/score.ts` was
discarding retrieval metrics for any case whose overall system output carried an error — but `runStaged`'s
retrieval step runs entirely before any model call, so a case that failed later (e.g. a live 429) still has real,
correct retrieval data that should not be thrown away. Confirmed against the live Gemini run from earlier the same
day, where every model call had failed on quota: re-aggregating its raw output with the fix recovered real
retrieval numbers (96% recall, 57% precision) that the original run had reported as "n/a".

## 17. GitHub-issue-shaped export
Roadmap item 6 named a Markdown export variant meant to be pasted into a GitHub issue body. Added
`exportGithubIssue()` (`src/server/workflow/export.ts`), wired to `GET /api/sessions/:id/export?format=issue`
and a new "Export as GitHub issue" button in `BriefPanel`. It keeps the fixture/demo disclosure banners
(a fixture brief must never be presented as real, per CLAUDE.md) but drops the full evidence index and
per-item citation lists the full Markdown export carries for audit purposes: acceptance criteria, steps and
tests render as `- [ ]` task-list checkboxes instead, which GitHub renders as trackable checklists. The
full evidence-linked export (Markdown or JSON) stays the audit trail; this variant is for tracking the work,
not re-deriving it. Verified live against the fixture provider through the actual UI (not just unit tests):
investigate through brief generation, then fetched the exported body and confirmed the checkbox formatting
and banners render correctly.

## 16. Test-pairing retrieval pass
Item 3 of the roadmap named this as an open idea: pair each retrieved source file with its own test file, since a
file's tests document its behavior regardless of what vocabulary the ticket happens to use. Implemented as a new
pass in `retrieveEvidence()` (`src/server/repository/search.ts`), running after the reference/definition hops and
before the final sort: for every picked source file (skipping files already under `tests/`), look up its
conventional test path — `tests/<stem>.test.ts` for the TypeScript/JS fixtures, `tests/test_<stem>.py` for the
Python one (`team-tasks`) — and add any matching chunks via the same `tryAdd` budget/dedup gate the other passes
use, capped at a new `maxTestPairs` option (default 6). Unlike the second-hop/forward-hop passes, this never reads
ticket text at all, so it can't be tuned to a specific benchmark case by construction. Regression check
(`npm run eval:regression`) after the change: recall unchanged (97.1%), distractors/case unchanged (0.71),
precision -0.8pt (52.4% -> 51.6%), well inside tolerance — expected, since none of the 17 dev cases currently
reward test-file evidence in their `expectedFiles`. Left the checked-in baseline as-is rather than lowering it,
since the drop is real cost from the feature's own excerpts, not drift to paper over.
