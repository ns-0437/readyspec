# Benchmark results: heldout set, provider "FIXTURE PROVIDER (scripted output, not a model)"

> **Fixture provider run.** No language model produced any output here. Metrics that depend on model output are marked n/a. The static-checklist column and the staged workflow's retrieval columns are real (deterministic). Do not read this as a model-quality result.

Cases: 7 (7 held out). Generated 2026-09-21T15:05:30.494Z.

| Metric | Static checklist | Single prompt | ReadySpec staged |
|---|---|---|---|
| Required-file recall (retrieval) | 0% | n/a (fixture) | 100% |
| Precision of files used | n/a | n/a (fixture) | 59% |
| Distractor files used / case | 0.00 | n/a (fixture) | 0.57 |
| Citation validity | n/a | n/a (fixture) | n/a (fixture) |
| Observed claims supported by cited code | n/a | n/a (fixture) | n/a (fixture) |
| Critical ambiguities asked | 0% | n/a (fixture) | n/a (fixture) |
| Critical ambiguities surfaced anywhere | 0% | n/a (fixture) | n/a (fixture) |
| Questions / case | 5.0 | n/a (fixture) | n/a (fixture) |
| Unnecessary question rate | 100% | n/a (fixture) | n/a (fixture) |
| Expected contradictions noticed | 0% | n/a (fixture) | n/a (fixture) |
| Insufficient evidence acknowledged | 0% | n/a (fixture) | n/a (fixture) |
| Unacceptable assumptions (count) | 0 | n/a (fixture) | n/a (fixture) |
| Followed planted injection (cases) | 0 | n/a (fixture) | n/a (fixture) |
| Reviewer-flag proxy / case | 0.0 | n/a (fixture) | n/a (fixture) |
| Mean latency (ms) | 0 | n/a (fixture) | n/a (fixture) |
| Input tokens (total) | 0 | n/a (fixture) | n/a (fixture) |
| Output tokens (total) | 0 | n/a (fixture) | n/a (fixture) |
| Cost (USD, needs READYSPEC_PRICE_*) | n/a | n/a (fixture) | n/a (fixture) |
| Failed cases (system error) | 0 | n/a (fixture) | 0 |

Single-prompt baseline context: 0 of 7 cases were truncated to the 24000-character budget; otherwise it saw the whole repository (so retrieval gives ReadySpec no advantage on small repositories).

## Per-case detail (staged workflow and checklist)

| Case | Held out | System | Req. files | Missed required | Ambiguities asked | Missed | Unnecessary Qs | Violations | Contradictions |
|---|---|---|---|---|---|---|---|---|---|
| demo-04-quiet-hours | yes | Static checklist | 0% | src/users/preferences.ts, docs/notifications.md, src/notifications/dispatcher.ts | 0/4 | security-exemption, null-timezone, overnight-and-dst, held-or-dropped | 5 | - | 0/1 |
| demo-04-quiet-hours | yes | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| demo-06-infinite-retry-bug | yes | Static checklist | 0% | src/notifications/retry-queue.ts, src/notifications/dispatcher.ts | 0/2 | reproduction, actual-symptom | 5 | - | 0/1 |
| demo-06-infinite-retry-bug | yes | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| shop-04-extend-refund-window | yes | Static checklist | 0% | src/orders/refunds.ts, docs/orders.md | 0/2 | existing-orders, doc-code-mismatch | 5 | - | 0/1 |
| shop-04-extend-refund-window | yes | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| shop-06-faster-orders | yes | Static checklist | 0% | src/orders/checkout.ts | 0/2 | metric, where-slow | 5 | - | - |
| shop-06-faster-orders | yes | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| tasks-03-mention-notify | yes | Static checklist | 0% | taskboard/comments.py, taskboard/notifications.py | 0/3 | unknown-or-inactive, self-mention, dedupe | 5 | - | 0/1 |
| tasks-03-mention-notify | yes | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| tasks-04-reminder-24h | yes | Static checklist | 0% | taskboard/reminders.py, docs/design.md | 0/3 | already-sent, short-notice, timezone | 5 | - | 0/1 |
| tasks-04-reminder-24h | yes | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| tasks-05-reassign-departing | yes | Static checklist | 0% | taskboard/tasks.py, taskboard/permissions.py, taskboard/models.py | 0/5 | which-tasks, notifications, departing-user-state, reminder-reset, audit | 5 | - | - |
| tasks-05-reassign-departing | yes | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
