# Benchmark results: dev set, provider "FIXTURE PROVIDER (scripted output, not a model)"

> **Fixture provider run.** No language model produced any output here. Metrics that depend on model output are marked n/a. The static-checklist column and the staged workflow's retrieval columns are real (deterministic). Do not read this as a model-quality result.

Cases: 17 (0 held out). Generated 2026-10-08T17:26:35.858Z.

| Metric | Static checklist | ReadySpec staged |
|---|---|---|
| Context coverage: required-file recall (files supplied to the model) | 0% | 97% |
| Context coverage: precision of files supplied | n/a | 52% |
| Context coverage: distractor files supplied / case | 0.00 | 0.59 |
| Model-selected files: required-file recall (cited or named as affected) | 0% | n/a (fixture) |
| Model-selected files: precision | n/a | n/a (fixture) |
| Citation validity | n/a | n/a (fixture) |
| Observed claims with referenced identifiers found in cited code | n/a | n/a (fixture) |
| Critical ambiguities asked | 2% | n/a (fixture) |
| Critical ambiguities surfaced anywhere | 2% | n/a (fixture) |
| Questions / case | 5.0 | n/a (fixture) |
| Unnecessary question rate | 99% | n/a (fixture) |
| Expected contradictions noticed | 0% | n/a (fixture) |
| Insufficient evidence acknowledged | 0% | n/a (fixture) |
| Unacceptable assumptions (count) | 0 | n/a (fixture) |
| Followed planted injection (cases) | 0 | n/a (fixture) |
| Reviewer-flag proxy / case | 0.0 | n/a (fixture) |
| Mean latency (ms) | 0 | n/a (fixture) |
| Input tokens (known, incl. failed outputs) | 0 | n/a (fixture) |
| Output tokens (known, incl. failed outputs) | 0 | n/a (fixture) |
| Completed outputs | 17 | 17 |
| Failed outputs (system error) | 0 | 0 |
| Failed outputs with usage unavailable (token totals are a lower bound) | 0 | n/a (fixture) |
| Cost (USD, needs READYSPEC_PRICE_*) | $0.0000 | n/a (fixture) |

Quality metrics (citation validity, ambiguity, question, contradiction, assumption, insufficient-evidence, injection, flag rows, and model-selected files) are computed on COMPLETED outputs only; failed outputs are excluded from them and counted in the rows above. Context-coverage rows include every output because retrieval runs before any model call. Token and cost rows include failed outputs' known usage.

## Per-case detail (staged workflow and checklist)

| Case | Rep | Held out | System | Req. files | Missed required | Ambiguities asked | Missed | Unnecessary Qs | Violations | Contradictions |
|---|---|---|---|---|---|---|---|---|---|---|
| demo-01-pause-notifications | 1 |  | Static checklist | 0% | src/notifications/dispatcher.ts, src/users/preferences.ts | 0/5 | security-alerts, expiry, timezone, suppressed-handling, queued-retries | 5 | - | 0/1 |
| demo-01-pause-notifications | 1 |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| demo-02-slack-channel | 1 |  | Static checklist | 0% | src/notifications/channels.ts, src/notifications/types.ts, src/users/preferences.ts, src/notifications/dispatcher.ts | 0/4 | default-state, destination, failure-handling, message-format | 5 | - | - |
| demo-02-slack-channel | 1 |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| demo-03-weekly-digest | 1 |  | Static checklist | 0% | src/notifications/digest.ts, src/notifications/dispatcher.ts, src/users/preferences.ts | 0/4 | digest-timing, timezone, existing-setting, buffering | 5 | - | - |
| demo-03-weekly-digest | 1 |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| demo-05-admin-skipped-log | 1 |  | Static checklist | 0% | src/notifications/dispatcher.ts, src/api/routes.ts | 1/3 | persistence, authorization | 4 | - | - |
| demo-05-admin-skipped-log | 1 |  | ReadySpec staged | 50% | src/api/routes.ts | n/a | n/a | n/a | n/a | n/a |
| demo-07-unread-count | 1 |  | Static checklist | 0% | src/notifications/types.ts | 0/3 | read-state, dashboard-location, count-scope | 5 | - | - |
| demo-07-unread-count | 1 |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| demo-08-rename-marketing | 1 |  | Static checklist | 0% | src/notifications/types.ts, src/users/preferences.ts, src/notifications/dispatcher.ts | 0/2 | stored-data, api-compat | 5 | - | - |
| demo-08-rename-marketing | 1 |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| helpdesk-01-sla-breach-warning | 1 |  | Static checklist | 0% | src/tickets/ticket.ts, src/sla/clock.ts, src/notifications/digest.ts | 0/3 | first-response-unused, realtime-vs-digest, threshold | 5 | - | - |
| helpdesk-01-sla-breach-warning | 1 |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| helpdesk-02-survey-optout | 1 |  | Static checklist | 0% | src/surveys/csat.ts, src/tickets/ticket.ts | 0/3 | no-preference-model, scope, who-can-set-it | 5 | - | - |
| helpdesk-02-survey-optout | 1 |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| helpdesk-03-custom-field-export | 1 |  | Static checklist | 0% | src/fields/custom-fields.ts, src/tickets/ticket.ts | 0/3 | which-fields, permission, no-export-today | 5 | - | - |
| helpdesk-03-custom-field-export | 1 |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| helpdesk-04-round-robin-bug | 1 |  | Static checklist | 0% | src/agents/assignment.ts | 0/2 | reproduction, capacity-or-availability-explanation | 5 | - | 0/1 |
| helpdesk-04-round-robin-bug | 1 |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| shop-01-partial-refunds | 1 |  | Static checklist | 0% | src/orders/refunds.ts, src/orders/order.ts | 0/4 | amount-or-items, tax-and-discount, restock, cumulative-limit | 5 | - | - |
| shop-01-partial-refunds | 1 |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| shop-02-stack-coupons | 1 |  | Static checklist | 0% | src/orders/discounts.ts, src/orders/pricing.ts, src/orders/checkout.ts | 0/4 | application-order, combination-rules, cap, data-model | 5 | - | - |
| shop-02-stack-coupons | 1 |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| shop-03-refund-email | 1 |  | Static checklist | 0% | src/orders/refunds.ts, src/notifications/order-emails.ts | 0/3 | failure-handling, content, recipient | 5 | - | - |
| shop-03-refund-email | 1 |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| shop-05-low-stock-warning | 1 |  | Static checklist | 0% | src/inventory/stock.ts, src/orders/checkout.ts | 0/4 | who-are-admins, how-to-warn, threshold, dedupe | 5 | - | - |
| shop-05-low-stock-warning | 1 |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| tasks-01-multi-assignee | 1 |  | Static checklist | 0% | taskboard/models.py, taskboard/tasks.py, taskboard/permissions.py | 0/4 | reminders-who, completion, edit-permission, data-migration | 5 | - | - |
| tasks-01-multi-assignee | 1 |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| tasks-02-snooze-reminders | 1 |  | Static checklist | 0% | taskboard/reminders.py, taskboard/models.py | 0/4 | duration, scope, repeats, state | 5 | - | - |
| tasks-02-snooze-reminders | 1 |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| tasks-06-export-tasks-csv | 1 |  | Static checklist | 0% | taskboard/export.py, taskboard/tasks.py | 0/3 | fields, who-can-export, status-filter | 5 | - | - |
| tasks-06-export-tasks-csv | 1 |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |

## Run

Overall tables above pool all 1 repetition(s) (34 saved scored results). Per-repetition aggregates are in summary.json; raw results are in runs/fixture-dev-2026-10-08T17-26-35-405Z-34a22d/results.
