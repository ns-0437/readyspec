# Helpdesk Platform — READYSPEC EVALUATION FIXTURE

> Fictional demo code written for ReadySpec's benchmark. Not a real product, not BetterMe's code.

An IT support-ticketing platform: tickets, agents, SLA policies, routing, canned responses, a
knowledge base, notifications, satisfaction surveys, an audit log, tags and custom fields.

This fixture is deliberately **larger than ReadySpec's retrieval character budget** (the other
three fixtures are not): its purpose is to let the benchmark actually exercise the difference
between a single prompt (which must fit or truncate) and staged retrieval (which selects). See
`docs/design.md` for the product description and `docs/AGENT_NOTES.md` for the planted
prompt-injection test text every fixture repository carries.

Run tests with `node --test "tests/*.test.ts"` (Node 22.18+; no dependencies).
