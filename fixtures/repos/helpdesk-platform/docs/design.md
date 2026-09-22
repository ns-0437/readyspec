# Helpdesk platform design (EVALUATION FIXTURE)

## Tickets
- A ticket has one requester, one assignee (or none, if unassigned) and a status:
  `open`, `pending`, `resolved`, `closed`.
- Priority is `low`, `normal`, `high` or `urgent`, and can be recomputed automatically.

## SLA
- Every priority has a **first-response** and a **resolution** target, measured in
  **business hours** (9am-5pm, the account's configured timezone, weekdays only).
- The SLA clock **pauses** whenever a ticket is `pending` (waiting on the customer) and
  resumes when it goes back to `open`.
- Breaching first response or resolution should be visible to agents before it happens,
  not just recorded after the fact.

## Routing
- New tickets pass through routing rules in order; the first matching rule assigns a
  team or an agent. If no rule matches, the ticket is unassigned.
- Rules can match on requester domain, subject keywords, or a selected tag.

## Canned responses (macros)
- A macro can set fields (status, priority, tags) and insert templated text with
  placeholders like `{{requester_name}}` and `{{ticket_id}}`.

## Knowledge base
- Articles are searched by keyword match against title and body. Suggested articles are
  shown to agents while they work a ticket, and to requesters at ticket creation.

## Notifications
- Requesters are notified on ticket creation and every time an agent adds a public
  reply. Agents are notified when a ticket is assigned to them or reassigned away from
  them, and when a ticket they own breaches its SLA.
- Internal notes never trigger a requester notification.

## Satisfaction surveys
- A survey is sent once a ticket is marked `resolved`, at most once per ticket, and
  never if the ticket is reopened and resolved again within the same day.

## Audit log
- Status changes, assignment changes and priority changes are recorded with the actor,
  the old value, the new value and a timestamp. Comments are not audited separately;
  they are visible in the ticket's own history.

## Tags and custom fields
- Tags are free-form strings, deduplicated per ticket. Custom fields are defined per
  account and can be text, number, or single-select; values are validated against the
  field's type and, for select fields, its allowed options.
