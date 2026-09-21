# Benchmark results: heldout-v2 set, provider "FIXTURE PROVIDER (scripted output, not a model)"

> **Fixture provider run.** No language model produced any output here. Metrics that depend on model output are marked n/a. The static-checklist column and the staged workflow's retrieval columns are real (deterministic). Do not read this as a model-quality result.

Cases: 6 (6 held out). Generated 2026-09-21T15:05:33.710Z.

| Metric | Static checklist | Single prompt | ReadySpec staged |
|---|---|---|---|
| Required-file recall (retrieval) | 0% | n/a (fixture) | 100% |
| Precision of files used | n/a | n/a (fixture) | 48% |
| Distractor files used / case | 0.00 | n/a (fixture) | 0.67 |
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

Single-prompt baseline context: 0 of 6 cases were truncated to the 24000-character budget; otherwise it saw the whole repository (so retrieval gives ReadySpec no advantage on small repositories).

## Per-case detail (staged workflow and checklist)

| Case | Held out | System | Req. files | Missed required | Ambiguities asked | Missed | Unnecessary Qs | Violations | Contradictions |
|---|---|---|---|---|---|---|---|---|---|
| demo-09-sms-marketing-optout | yes | Static checklist | 0% | src/users/preferences.ts, src/notifications/dispatcher.ts | 0/3 | data-model, existing-users, other-categories | 5 | - | - |
| demo-09-sms-marketing-optout | yes | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| demo-10-preference-history | yes | Static checklist | 0% | src/users/preferences.ts, src/api/routes.ts | 0/3 | retention, who-sees, what-counts | 5 | - | - |
| demo-10-preference-history | yes | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| shop-07-gift-orders | yes | Static checklist | 0% | src/orders/checkout.ts, src/notifications/order-emails.ts, src/orders/order.ts | 0/3 | who-gets-what, later-emails, data-model | 5 | - | - |
| shop-07-gift-orders | yes | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| shop-08-back-in-stock | yes | Static checklist | 0% | src/inventory/stock.ts | 0/3 | who-to-notify, restock-trigger, dedupe | 5 | - | - |
| shop-08-back-in-stock | yes | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| tasks-07-overdue-daily | yes | Static checklist | 0% | taskboard/reminders.py, taskboard/models.py | 0/4 | status-model, cadence, stop-conditions, one-shot-flag | 5 | - | - |
| tasks-07-overdue-daily | yes | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| tasks-08-private-tasks | yes | Static checklist | 0% | taskboard/permissions.py, taskboard/models.py | 0/3 | admin-visibility, leak-paths, existing-and-reassign | 5 | - | 0/1 |
| tasks-08-private-tasks | yes | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
