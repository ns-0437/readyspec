# Implementation plan and status

1. **Foundation** — done. CLAUDE.md, docs, demo fixture, Zod schemas, SQLite persistence. (The
   interface was built against the real API rather than as a mock; see decisions.md 11.)
2. **Repository intelligence** — done. Safe fs, filters, snapshots, symbol-aware lexical search, evidence + validation.
3. **Working agent** — done. Provider adapters (Anthropic, Gemini, Groq + labelled fixture),
   budgets/retries/cancel, stages, clarification loop, brief generation. Gemini validated live
   2026-09-22 (decisions.md 14); Groq live-tested 2026-09-25, hits a free-tier throughput ceiling
   on the analyze stage (decisions.md 21); Anthropic still untested (no key).
4. **Verification + evals** — done. Citation/support/coverage checks, approval gate, 193 tests, 30-case benchmark
   (17 dev, 7 held-out v1 contaminated, 6 held-out v2 clean), runner for three systems. Only deterministic
   results exist (evals/REPORT.md).
5. **Finish** — README, report, demo script done. Remaining: a live-model run, human scoring.

Next: get an API key (Anthropic, Gemini or Groq — a Groq key is free, no card), run
`npm run eval -- --provider anthropic --set dev` (or `--provider gemini` / `--provider groq`), fix
the biggest weakness it exposes, run `--set heldout-v2` once, then update evals/REPORT.md.
