# 90-second demonstration

Story: *"I built a repository-aware agent that helps engineers resolve ambiguity before
implementation, with code-backed evidence and a benchmark against simpler approaches."*

Prep: `npm run dev`, open http://localhost:3000. With no API key the app runs the fixture provider
and says so in a banner. Say so in the recording too: the demo shows the product and its
guardrails, not model quality. If you have a key, set `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` or
`GROQ_API_KEY` (free tier, no card) first and the same flow runs against the real model — Gemini
and Groq have both been live-validated for the mechanics shown here (see README status for exactly
what that did and didn't prove; Anthropic has no key yet).

| Time | Do | Say |
|---|---|---|
| 0:00 | Home page: demo repository and ticket "Let users pause notifications while they are away." pre-filled. Click **Investigate repository**. | "Fictional demo app, not any company's code. Investigation is local and deterministic." |
| 0:12 | Point at the excluded list (.env, logo.png, generated file) and the red "instruction-like text" badge on `docs/AGENT_NOTES.md`. | "Secrets and binaries never get read. This doc tries to give the assistant orders. It is flagged and treated as data." |
| 0:25 | Show the disclosure list; tick consent; **Analyze**. | "Nothing goes to a model until I've seen exactly which excerpts would." |
| 0:35 | Read question 1 (security alerts) and question 3 (how the pause ends). Accept a suggestion for one, type an answer for another, tick **Leave unresolved** on the timezone question. **Save answers and generate brief.** | "Five questions max, ranked. Suggestions are options, not decisions. I can leave one open and the brief will keep it open." |
| 0:55 | Brief appears. Point at the four labelled kinds, then the Verification card: citations valid, criteria tested. | "Observed, proposed, assumed, unresolved, never blurred. Every claim about existing code cites lines in a pinned snapshot." |
| 1:05 | Click an acceptance criterion. | "The signature interaction: evidence, affected components and the proposed test, together. Blocked criteria show which question is still open." |
| 1:15 | Edit a criterion; **Save and re-verify**. Delete a test from a criterion and show the verification error blocking approval. | "Edits re-verify. Approval needs a passing check, a named reviewer, and an acknowledgement of open questions." |
| 1:25 | Export Markdown, then point at the GitHub-issue export button. Then show `evals/REPORT.md`. | "Markdown, JSON, or task-list checkboxes ready to paste into an issue — fixture output labelled in all three. And the benchmark report says exactly what has and has not been measured." |

Do not claim: model quality, reduced time to market, or anything about BetterMe's systems.
