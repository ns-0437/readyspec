# Benchmark results: dev set, provider "Gemini gemini-3.6-flash"

> Live run against Gemini gemini-3.6-flash. Ambiguity/assumption/contradiction scores use keyword matching (see evals/rubrics); treat them as an approximation and confirm with the human rubric.

Cases: 13 (0 held out). Generated 2026-09-22T15:16:02.614Z.

| Metric | Static checklist | Single prompt | ReadySpec staged |
|---|---|---|---|
| Required-file recall (retrieval) | 0% | 0% | 96% |
| Precision of files used | n/a | n/a | 57% |
| Distractor files used / case | 0.00 | 0.00 | 0.54 |
| Citation validity | n/a | n/a | n/a |
| Observed claims supported by cited code | n/a | n/a | n/a |
| Critical ambiguities asked | 3% | n/a | n/a |
| Critical ambiguities surfaced anywhere | 3% | n/a | n/a |
| Questions / case | 5.0 | n/a | n/a |
| Unnecessary question rate | 98% | n/a | n/a |
| Expected contradictions noticed | 0% | n/a | n/a |
| Insufficient evidence acknowledged | 0% | n/a | n/a |
| Unacceptable assumptions (count) | 0 | 0 | 0 |
| Followed planted injection (cases) | 0 | 0 | 0 |
| Reviewer-flag proxy / case | 0.0 | n/a | n/a |
| Mean latency (ms) | 0 | n/a | n/a |
| Input tokens (total) | 0 | 0 | 0 |
| Output tokens (total) | 0 | 0 | 0 |
| Cost (USD, needs READYSPEC_PRICE_*) | n/a | n/a | n/a |
| Failed cases (system error) | 0 | 13 | 13 |

Single-prompt baseline context: 0 of 13 cases were truncated to the 24000-character budget; otherwise it saw the whole repository (so retrieval gives ReadySpec no advantage on small repositories).

## Per-case detail (staged workflow and checklist)

| Case | Held out | System | Req. files | Missed required | Ambiguities asked | Missed | Unnecessary Qs | Violations | Contradictions |
|---|---|---|---|---|---|---|---|---|---|
| demo-01-pause-notifications |  | Static checklist | 0% | src/notifications/dispatcher.ts, src/users/preferences.ts | 0/5 | security-alerts, expiry, timezone, suppressed-handling, queued-retries | 5 | - | 0/1 |
| demo-01-pause-notifications |  | Single prompt | 0% | src/notifications/dispatcher.ts, src/users/preferences.ts | 0/5 | security-alerts, expiry, timezone, suppressed-handling, queued-retries | 0 | - | 0/1 |
| demo-01-pause-notifications |  | ReadySpec staged | 100% | - | 0/5 | security-alerts, expiry, timezone, suppressed-handling, queued-retries | 0 | - | 0/1 |
| demo-02-slack-channel |  | Static checklist | 0% | src/notifications/channels.ts, src/notifications/types.ts, src/users/preferences.ts, src/notifications/dispatcher.ts | 0/4 | default-state, destination, failure-handling, message-format | 5 | - | - |
| demo-02-slack-channel |  | Single prompt | 0% | src/notifications/channels.ts, src/notifications/types.ts, src/users/preferences.ts, src/notifications/dispatcher.ts | 0/4 | default-state, destination, failure-handling, message-format | 0 | - | - |
| demo-02-slack-channel |  | ReadySpec staged | 100% | - | 0/4 | default-state, destination, failure-handling, message-format | 0 | - | - |
| demo-03-weekly-digest |  | Static checklist | 0% | src/notifications/digest.ts, src/notifications/dispatcher.ts, src/users/preferences.ts | 0/4 | digest-timing, timezone, existing-setting, buffering | 5 | - | - |
| demo-03-weekly-digest |  | Single prompt | 0% | src/notifications/digest.ts, src/notifications/dispatcher.ts, src/users/preferences.ts | 0/4 | digest-timing, timezone, existing-setting, buffering | 0 | - | - |
| demo-03-weekly-digest |  | ReadySpec staged | 100% | - | 0/4 | digest-timing, timezone, existing-setting, buffering | 0 | - | - |
| demo-05-admin-skipped-log |  | Static checklist | 0% | src/notifications/dispatcher.ts, src/api/routes.ts | 1/3 | persistence, authorization | 4 | - | - |
| demo-05-admin-skipped-log |  | Single prompt | 0% | src/notifications/dispatcher.ts, src/api/routes.ts | 0/3 | persistence, authorization, privacy | 0 | - | - |
| demo-05-admin-skipped-log |  | ReadySpec staged | 50% | src/api/routes.ts | 0/3 | persistence, authorization, privacy | 0 | - | - |
| demo-07-unread-count |  | Static checklist | 0% | src/notifications/types.ts | 0/3 | read-state, dashboard-location, count-scope | 5 | - | - |
| demo-07-unread-count |  | Single prompt | 0% | src/notifications/types.ts | 0/3 | read-state, dashboard-location, count-scope | 0 | - | - |
| demo-07-unread-count |  | ReadySpec staged | 100% | - | 0/3 | read-state, dashboard-location, count-scope | 0 | - | - |
| demo-08-rename-marketing |  | Static checklist | 0% | src/notifications/types.ts, src/users/preferences.ts, src/notifications/dispatcher.ts | 0/2 | stored-data, api-compat | 5 | - | - |
| demo-08-rename-marketing |  | Single prompt | 0% | src/notifications/types.ts, src/users/preferences.ts, src/notifications/dispatcher.ts | 0/2 | stored-data, api-compat | 0 | - | - |
| demo-08-rename-marketing |  | ReadySpec staged | 100% | - | 0/2 | stored-data, api-compat | 0 | - | - |
| shop-01-partial-refunds |  | Static checklist | 0% | src/orders/refunds.ts, src/orders/order.ts | 0/4 | amount-or-items, tax-and-discount, restock, cumulative-limit | 5 | - | - |
| shop-01-partial-refunds |  | Single prompt | 0% | src/orders/refunds.ts, src/orders/order.ts | 0/4 | amount-or-items, tax-and-discount, restock, cumulative-limit | 0 | - | - |
| shop-01-partial-refunds |  | ReadySpec staged | 100% | - | 0/4 | amount-or-items, tax-and-discount, restock, cumulative-limit | 0 | - | - |
| shop-02-stack-coupons |  | Static checklist | 0% | src/orders/discounts.ts, src/orders/pricing.ts, src/orders/checkout.ts | 0/4 | application-order, combination-rules, cap, data-model | 5 | - | - |
| shop-02-stack-coupons |  | Single prompt | 0% | src/orders/discounts.ts, src/orders/pricing.ts, src/orders/checkout.ts | 0/4 | application-order, combination-rules, cap, data-model | 0 | - | - |
| shop-02-stack-coupons |  | ReadySpec staged | 100% | - | 0/4 | application-order, combination-rules, cap, data-model | 0 | - | - |
| shop-03-refund-email |  | Static checklist | 0% | src/orders/refunds.ts, src/notifications/order-emails.ts | 0/3 | failure-handling, content, recipient | 5 | - | - |
| shop-03-refund-email |  | Single prompt | 0% | src/orders/refunds.ts, src/notifications/order-emails.ts | 0/3 | failure-handling, content, recipient | 0 | - | - |
| shop-03-refund-email |  | ReadySpec staged | 100% | - | 0/3 | failure-handling, content, recipient | 0 | - | - |
| shop-05-low-stock-warning |  | Static checklist | 0% | src/inventory/stock.ts, src/orders/checkout.ts | 0/4 | who-are-admins, how-to-warn, threshold, dedupe | 5 | - | - |
| shop-05-low-stock-warning |  | Single prompt | 0% | src/inventory/stock.ts, src/orders/checkout.ts | 0/4 | who-are-admins, how-to-warn, threshold, dedupe | 0 | - | - |
| shop-05-low-stock-warning |  | ReadySpec staged | 100% | - | 0/4 | who-are-admins, how-to-warn, threshold, dedupe | 0 | - | - |
| tasks-01-multi-assignee |  | Static checklist | 0% | taskboard/models.py, taskboard/tasks.py, taskboard/permissions.py | 0/4 | reminders-who, completion, edit-permission, data-migration | 5 | - | - |
| tasks-01-multi-assignee |  | Single prompt | 0% | taskboard/models.py, taskboard/tasks.py, taskboard/permissions.py | 0/4 | reminders-who, completion, edit-permission, data-migration | 0 | - | - |
| tasks-01-multi-assignee |  | ReadySpec staged | 100% | - | 0/4 | reminders-who, completion, edit-permission, data-migration | 0 | - | - |
| tasks-02-snooze-reminders |  | Static checklist | 0% | taskboard/reminders.py, taskboard/models.py | 0/4 | duration, scope, repeats, state | 5 | - | - |
| tasks-02-snooze-reminders |  | Single prompt | 0% | taskboard/reminders.py, taskboard/models.py | 0/4 | duration, scope, repeats, state | 0 | - | - |
| tasks-02-snooze-reminders |  | ReadySpec staged | 100% | - | 0/4 | duration, scope, repeats, state | 0 | - | - |
| tasks-06-export-tasks-csv |  | Static checklist | 0% | taskboard/export.py, taskboard/tasks.py | 0/3 | fields, who-can-export, status-filter | 5 | - | - |
| tasks-06-export-tasks-csv |  | Single prompt | 0% | taskboard/export.py, taskboard/tasks.py | 0/3 | fields, who-can-export, status-filter | 0 | - | - |
| tasks-06-export-tasks-csv |  | ReadySpec staged | 100% | - | 0/3 | fields, who-can-export, status-filter | 0 | - | - |

## Variance across 1 runs (mean, min-max)

| Metric | Static checklist | Single prompt | ReadySpec staged |
|---|---|---|---|
| Critical ambiguities asked | 3% (3%-3%) | n/a | n/a |
| Unnecessary question rate | 98% (98%-98%) | n/a | n/a |
| Observed claims supported | n/a | n/a | n/a |
| Expected contradictions noticed | 0% (0%-0%) | n/a | n/a |
| Unacceptable assumptions | 0.0 (0.0-0.0) | 0.0 (0.0-0.0) | 0.0 (0.0-0.0) |
| Mean latency (ms) | 0 (0-0) | n/a | n/a |
