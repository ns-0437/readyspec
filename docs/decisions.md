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
Twenty-six hand-authored cases over three small repositories; thirteen are held out in two cohorts (see 13; run once, after
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
