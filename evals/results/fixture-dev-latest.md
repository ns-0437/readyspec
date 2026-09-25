# Benchmark results: dev set, provider "FIXTURE PROVIDER (scripted output, not a model)"

> **Fixture provider run.** No language model produced any output here. Metrics that depend on model output are marked n/a. The static-checklist column and the staged workflow's retrieval columns are real (deterministic). Do not read this as a model-quality result.

Cases: 17 (0 held out). Generated 2026-09-25T02:59:31.934Z.

| Metric | Static checklist | Single prompt | ReadySpec staged |
|---|---|---|---|
| Required-file recall (retrieval) | 0% | n/a (fixture) | 97% |
| Precision of files used | n/a | n/a (fixture) | 52% |
| Distractor files used / case | 0.00 | n/a (fixture) | 0.59 |
| Citation validity | n/a | n/a (fixture) | n/a (fixture) |
| Observed claims supported by cited code | n/a | n/a (fixture) | n/a (fixture) |
| Critical ambiguities asked | 2% | n/a (fixture) | n/a (fixture) |
| Critical ambiguities surfaced anywhere | 2% | n/a (fixture) | n/a (fixture) |
| Questions / case | 5.0 | n/a (fixture) | n/a (fixture) |
| Unnecessary question rate | 99% | n/a (fixture) | n/a (fixture) |
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

Single-prompt baseline context: 4 of 17 cases were truncated to the 24000-character budget; otherwise it saw the whole repository (so retrieval gives ReadySpec no advantage on small repositories).

## Per-case detail (staged workflow and checklist)

| Case | Held out | System | Req. files | Missed required | Ambiguities asked | Missed | Unnecessary Qs | Violations | Contradictions |
|---|---|---|---|---|---|---|---|---|---|
| demo-01-pause-notifications |  | Static checklist | 0% | src/notifications/dispatcher.ts, src/users/preferences.ts | 0/5 | security-alerts, expiry, timezone, suppressed-handling, queued-retries | 5 | - | 0/1 |
| demo-01-pause-notifications |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| demo-02-slack-channel |  | Static checklist | 0% | src/notifications/channels.ts, src/notifications/types.ts, src/users/preferences.ts, src/notifications/dispatcher.ts | 0/4 | default-state, destination, failure-handling, message-format | 5 | - | - |
| demo-02-slack-channel |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| demo-03-weekly-digest |  | Static checklist | 0% | src/notifications/digest.ts, src/notifications/dispatcher.ts, src/users/preferences.ts | 0/4 | digest-timing, timezone, existing-setting, buffering | 5 | - | - |
| demo-03-weekly-digest |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| demo-05-admin-skipped-log |  | Static checklist | 0% | src/notifications/dispatcher.ts, src/api/routes.ts | 1/3 | persistence, authorization | 4 | - | - |
| demo-05-admin-skipped-log |  | ReadySpec staged | 50% | src/api/routes.ts | n/a | n/a | n/a | n/a | n/a |
| demo-07-unread-count |  | Static checklist | 0% | src/notifications/types.ts | 0/3 | read-state, dashboard-location, count-scope | 5 | - | - |
| demo-07-unread-count |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| demo-08-rename-marketing |  | Static checklist | 0% | src/notifications/types.ts, src/users/preferences.ts, src/notifications/dispatcher.ts | 0/2 | stored-data, api-compat | 5 | - | - |
| demo-08-rename-marketing |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| helpdesk-01-sla-breach-warning |  | Static checklist | 0% | src/tickets/ticket.ts, src/sla/clock.ts, src/notifications/digest.ts | 0/3 | first-response-unused, realtime-vs-digest, threshold | 5 | - | - |
| helpdesk-01-sla-breach-warning |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| helpdesk-02-survey-optout |  | Static checklist | 0% | src/surveys/csat.ts, src/tickets/ticket.ts | 0/3 | no-preference-model, scope, who-can-set-it | 5 | - | - |
| helpdesk-02-survey-optout |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| helpdesk-03-custom-field-export |  | Static checklist | 0% | src/fields/custom-fields.ts, src/tickets/ticket.ts | 0/3 | which-fields, permission, no-export-today | 5 | - | - |
| helpdesk-03-custom-field-export |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| helpdesk-04-round-robin-bug |  | Static checklist | 0% | src/agents/assignment.ts | 0/2 | reproduction, capacity-or-availability-explanation | 5 | - | 0/1 |
| helpdesk-04-round-robin-bug |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| shop-01-partial-refunds |  | Static checklist | 0% | src/orders/refunds.ts, src/orders/order.ts | 0/4 | amount-or-items, tax-and-discount, restock, cumulative-limit | 5 | - | - |
| shop-01-partial-refunds |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| shop-02-stack-coupons |  | Static checklist | 0% | src/orders/discounts.ts, src/orders/pricing.ts, src/orders/checkout.ts | 0/4 | application-order, combination-rules, cap, data-model | 5 | - | - |
| shop-02-stack-coupons |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| shop-03-refund-email |  | Static checklist | 0% | src/orders/refunds.ts, src/notifications/order-emails.ts | 0/3 | failure-handling, content, recipient | 5 | - | - |
| shop-03-refund-email |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| shop-05-low-stock-warning |  | Static checklist | 0% | src/inventory/stock.ts, src/orders/checkout.ts | 0/4 | who-are-admins, how-to-warn, threshold, dedupe | 5 | - | - |
| shop-05-low-stock-warning |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| tasks-01-multi-assignee |  | Static checklist | 0% | taskboard/models.py, taskboard/tasks.py, taskboard/permissions.py | 0/4 | reminders-who, completion, edit-permission, data-migration | 5 | - | - |
| tasks-01-multi-assignee |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| tasks-02-snooze-reminders |  | Static checklist | 0% | taskboard/reminders.py, taskboard/models.py | 0/4 | duration, scope, repeats, state | 5 | - | - |
| tasks-02-snooze-reminders |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
| tasks-06-export-tasks-csv |  | Static checklist | 0% | taskboard/export.py, taskboard/tasks.py | 0/3 | fields, who-can-export, status-filter | 5 | - | - |
| tasks-06-export-tasks-csv |  | ReadySpec staged | 100% | - | n/a | n/a | n/a | n/a | n/a |
