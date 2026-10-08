# ReadySpec — CLAUDE.md

Repository-aware agent: rough engineering ticket in, evidence-backed implementation
brief out. Personal portfolio project. Deeper docs: [docs/product.md](docs/product.md),
[docs/architecture.md](docs/architecture.md), [docs/decisions.md](docs/decisions.md),
[docs/plan.md](docs/plan.md).

## Status (update every milestone)

Milestones 1-5 built and checked: lint, typecheck, 200 tests, production build, and the UI driven
end to end in a browser. **Gemini (`gemini-3.6-flash`) is validated live** as of 2026-09-22: full
staged pipeline completed via `npm run smoke:live` and separately through the real browser UI;
three real schema-compatibility bugs were found from live 400s and fixed (docs/decisions.md 14) —
the mock-server tests, written from documentation-level guesses, missed all three, which is exactly
why "not validated" belonged in this file before now. **A third provider, Groq, was added
2026-09-25** (free tier, OpenAI-compatible, `src/server/llm/groq.ts`): live-tested with a real key,
its single structured call passes cleanly, but the staged pipeline's `analyze` stage exceeds this
account's Groq free-tier throughput (8000 tokens/minute, account-wide) by a small margin — a real
free-tier ceiling, not a code bug (docs/decisions.md 21). Chasing it found and fixed a genuine,
provider-agnostic bug: retry backoff ignored a provider's `Retry-After` header, now honoured by all
three adapters. **Still NOT done:** (1) Anthropic has never run against a real API (no credentials),
still mock-server-only, and (2) no model-dependent benchmark result exists end-to-end for any
provider (`npm run eval` needs dozens of calls; Gemini hit quota, Groq hits its throughput ceiling
on the `analyze` stage). Everything that runs by default (no key) uses the labelled fixture provider
(scripted output). Benchmark: retrieval + static checklist are real; see evals/REPORT.md for what is
and is not measured.

**Verification wording (2026-10-08):** the lexical check only finds identifiers in cited lines, so
the UI/exports now say "Referenced identifiers found" and "Structural checks passed/failed", with a
note that this does not prove behavioral correctness. Internal enums (`supported`, `passed`) and
approval gating are unchanged. A regression test documents that opposite claims sharing identifiers
get the same result. Semantic verification does not exist.

**Baseline fairness (2026-10-08):** the main single-prompt baseline now receives the identical
`investigate()` excerpts as the staged workflow (one call, same system prompt/provider). Context
coverage (files supplied) and model-selected files are separate metrics. The old alphabetical-file
baseline remains as a secondary (`--systems single_alphabetical`). It measures pre-answer quality,
not a completed clarification loop; remaining asymmetries are listed in docs/evaluation.md. No live
benchmark has been run with it.

**Durable eval results (2026-10-08):** each `npm run eval` run now has its own directory under
`evals/results/runs/` with one immutable file per case/system/repetition saved immediately (failures
included), a write-once human scoring sheet, per-repetition and pooled summaries, and cost totals that
include failed outputs' known usage and say when usage is unknown. See docs/evaluation.md. No resume or
parallelism; not run live.

**Budget accounting (2026-10-08):** every dispatched request attempt (retries and provider failures
included) is reserved and prechecked before `provider.complete()`; a dollar ceiling now needs explicit
non-negative prices (0 allowed) or is rejected, and checks estimated worst-case cost per request.
Failed attempts persist in `usage_failures` as token reservations and are never invented as actual
usage; no HTTP status is assumed charge-free (4xx included). Dollars are rebuilt from tokens with the
current prices, so enabling a ceiling later does not treat unpriced history as free; sessions that
predate tracking are refused a dollar ceiling (`usage_accounting`). Estimates are heuristic (chars/4), so the
ceiling is not an exact billing guarantee. Not run against live providers.

**Eval-wide budget and pilot (2026-10-08):** `npm run eval` accepts run-wide limits shared by all cases,
systems, repetitions and retries (`--max-calls/--max-input-tokens/--max-output-tokens/--max-cost-usd`);
live runs refuse to start without the first three. Exhaustion stops dispatch, keeps completed results,
saves the interrupted case unscored and lists the rest as not run (`run-accounting.json`), apart from
model failures. `--pilot --dry-run` plans the five-case same-evidence-vs-staged pilot with zero provider
calls. No live pilot has been run and no spending limit is authorized yet.

**Compact profile (2026-10-08):** `--profile compact` (output allowances 1500/1000/2500, single prompt 2500;
unvalidated hypotheses) and `--evidence-max-chars` (one retrieval cap for both systems) make requests fit
small provider allowances; `--dry-run` shows fit, margin, excluded excerpts and the budget needed. For
demo-01 against an 8000-token allowance, three of four requests fit with full evidence; the brief does
not. A single-case run is a feasibility check, not a benchmark. No live call made.

## Purpose, user, scope

**Eval CLI validation (2026-10-08):** `evals/runners/cli.ts` rejects misspelled/duplicate flags,
unknown systems/case IDs, invalid repetition counts and conflicting pilot overrides before execution.
Pilot remains five development cases and one repetition. Tests: `tests/eval-cli.test.ts`.

**Retry cancellation (2026-10-08):** backoff rejects an already-aborted signal and removes its abort
listener both on timeout and cancellation. Tests cover aborts immediately before and during the wait;
neither dispatches another request.

**Clarification identity (2026-10-08):** questions deduplicate within a round as well as against
history; normalization preserves Unicode letters/numbers. IDs cannot collide with previous questions,
recorded decisions, or earlier questions in the same model response. Regression tests: `tests/clarify.test.ts`.

**README presentation (2026-10-08):** README now includes a repository-local SVG banner, expandable
walkthrough/configuration/code-map sections, Mermaid workflow, and an explicit measured-vs-unproven
table. `docs/assets/readyspec-hero.svg` is hand-authored vector artwork; the walkthrough is labelled
illustrative, not a live-model result.

**Publishing checks (2026-10-08):** all 246 tests pass locally. CI's key-free benchmark now explicitly
selects checklist + staged, because fixture runs measure retrieval/checklist mechanics and the
production output allowances intentionally differ between single-prompt and staged briefs.
The dev fixture report has been regenerated with durable-run accounting. No live evaluation run.

- **User:** an engineer or tech lead preparing a ticket for implementation.
- **Flow:** select repo -> enter ticket -> investigate (local) -> review disclosure + consent ->
  answer <=5 clarification questions -> review/edit/approve/export brief. One repo per
  session, one model provider.
- **Brief contains:** outcome, scope/non-goals, existing behavior (cited), decisions, open
  questions, acceptance criteria, affected components, steps, tests, risks, assumptions.
- **Non-goals (MVP):** editing repos, running their code, installing their deps, PR creation,
  Slack/Jira, org-wide indexing, reviewer routing, delivery dashboards, vector DB,
  multi-agent orchestration. Do not add these without a demonstrated need.

## Stack and boundaries

TypeScript, Next.js 16 (app router), `node:sqlite` (built in; loaded with
`process.getBuiltinModule` so bundlers ignore it; Node >= 22.13), Zod 4, Vitest, tsx.
Model adapters behind `src/server/llm/provider.ts`; Anthropic, Gemini and Groq, all via plain
`fetch` (no vendor SDKs), selected by `createProvider()`. A session pins one provider for its lifetime.

- `src/shared` — Zod schemas, pure helpers (trace, brief-edit, redact). No I/O.
- `src/server/repository` — snapshot, safe file access, filters, search, evidence. No model calls.
- `src/server/llm` — provider adapters, prompts, budgets, structured generation. No repo access.
- `src/server/workflow` — stage logic, verification, export, orchestration (`service.ts`).
- `src/server/persistence` — SQLite only.
- `src/app/api` — thin handlers: parse with Zod, call the service, map errors to HTTP.
- `src/components` — UI only; state ops live in `src/shared`.

## Rules that must hold

- Validate every stage boundary, API body, API response (client) and persisted artifact with Zod.
- Four content kinds, never blurred: **observed** (needs evidence), **proposed**
  (change/criterion/step/test), **assumed** (explicit, temporary), **unresolved** (needs a
  human). Never silently pick product policy; suggested answers are options only. Recorded
  human answers are authoritative and re-imposed after brief generation.
- Evidence = path + line range + sha256 of the lines, against an immutable, content-addressed
  snapshot stored in SQLite. Citation validity != support; support (lexical check, optional
  model judge) is separate. Only lexical/deterministic results gate approval.
- Repo text and tickets are untrusted data: fenced in prompts, injection heuristics flag them,
  no tools are exposed to the model, so text cannot trigger actions.
- Read-only: never execute repo code, install deps, or write inside a selected repo. Reads are
  confined to allowed roots; symlinks/junctions are never followed; secrets, binaries,
  generated, minified, oversized and secret-bearing files are excluded.
- No model call before the user reviews the disclosed excerpts and consents. Providers see
  only rendered prompts (`LlmRequest.context` is fixture-only and never sent).
- Secrets stay server-side; error text and logs pass through `redactSecrets`.
- A fixture provider must never be presented as a real model result (banners, brief
  `producedBy`, exports, eval reports all carry the label).
- Human approval is required and only via `service.approve` (needs passing verification for
  the current revision, plus acknowledgement of unresolved items). Editing clears approval.

## Conventions

Strict TS, no `any` (lint-enforced). Prompts live in `src/server/llm/prompts/`, not in
orchestration. Jobs are resumable (`failed`/`cancelled` keep artifacts and decisions).
Don't store secrets, transcripts or long progress logs in this file.
Dev note: restart `npm run dev` after editing server modules; the service singleton on `globalThis`
keeps old module code across hot reloads (this hid a fix once).
Editing files: heredocs/`node -e` through the Bash tool have mangled backslashes and
long files; prefer the Write/Edit tools for source with regexes.

## Directory map (implemented)

- `src/shared/schemas.ts` — every Zod schema/type (evidence, analysis, questions, brief, verification, session, API bodies, baseline output).
- `src/shared/{redact,trace,brief-edit}.ts` — secret patterns; criterion traceability; pure draft-editing ops.
- `src/server/repository/` — `safe-fs` (root/allowlist/traversal), `filters` (exclusions, injection heuristics), `snapshot`, `symbols`, `search` (BM25 + symbol hops + test-file pairing, decisions.md 16), `evidence` (ids, hashing, verification), `inspect`, `discover`, `types`.
- `src/server/llm/` — `provider` (interfaces, errors, `Retry-After` parsing), `anthropic`, `gemini`, `groq`, `fixture/` (scripted demo + mechanical fallback), `generate` (retries/validation/cancel, provider-aware backoff), `budget`, `contexts`, `prompts/`, `index` (provider selection: explicit `READYSPEC_PROVIDER` wins; else key presence, Anthropic > Gemini > Groq; else fixture).
- `src/server/workflow/` — `investigate` (stages 1-2 + disclosure), `stages` (analyze/clarify/brief/judge), `verify` + `support` (stage 6), `service` (session state machine, jobs), `export` (Markdown, JSON, GitHub-issue-shaped, decisions.md 17), `errors`.
- `src/server/persistence/` — `db` (schema), `store` (typed access).
- `src/app/` — `page.tsx`, `sessions/[id]/page.tsx`, `api/**/route.ts`.
- `src/components/` — `Home`, `Workspace`, `TicketPanel`, `EvidenceExplorer` (+ traceability inspector), `BriefPanel`, `ActivityLog`, `Badges`, `api`.
- `fixtures/demo-repository/` — labelled DEMO TypeScript app (auth, notifications, preferences, tests) with planted secret, binary, generated file, conflicting docs and a prompt-injection doc. Has its own passing tests.
- `fixtures/repos/{shop-orders,team-tasks}/` — labelled evaluation repos (TypeScript, Python); shop-orders has runnable tests.
- `evals/` — `cases/*.json` (30 hand-authored: 17 dev [4 against helpdesk-platform, the one fixture larger than the retrieval budget], 7 held-out v1 contaminated, 6 held-out v2 clean), `runners/` (schema, score, systems, report, run, cases), `rubrics/human-rubric.md`, `results/`, `REPORT.md`.
- `tests/` — Vitest suites (repository safety, search/evidence, LLM layer + mock Anthropic/Gemini servers, verifier, service, API, edit/trace/export, eval scoring/case integrity).
- `scripts/live-smoke.ts` — live-path smoke test; `.github/workflows/ci.yml` — lint, typecheck, tests, fixture tests, deterministic eval, build.
- `evals/runners/regression.ts` + `evals/baseline-retrieval.json` — deterministic retrieval-regression check (`npm run eval:regression`); `.github/workflows/retrieval-regression.yml` runs it weekly + on PRs touching retrieval; `.github/dependabot.yml` — weekly npm/actions updates (zod majors excluded, see decisions.md 14).
- `.env.example` — every supported env var, commented out.
- `docs/` — product, architecture, decisions, evaluation, demo (90-second script), live-validation, roadmap, plan.

## Commands (all verified)

```
npm install
npm run dev            # http://localhost:3000 (fixture provider unless ANTHROPIC_API_KEY, GEMINI_API_KEY or GROQ_API_KEY set)
npm run lint           # eslint
npm run typecheck      # tsc for app + fixtures
npm test               # vitest
npm run test:fixtures  # node --test on the demo + shop-orders fixtures' own tests
npm run check          # lint + typecheck + test
npm run build          # production build
npm run eval -- --provider fixture --set dev --systems checklist,staged # key-free retrieval/checklist mechanics
npm run eval:regression                        # deterministic retrieval-only regression check against evals/baseline-retrieval.json
npm run smoke:live     # first-contact live check (needs ANTHROPIC_API_KEY, GEMINI_API_KEY or GROQ_API_KEY); see docs/live-validation.md
```

Config (env): `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), `GROQ_API_KEY` (free
tier, no card: https://console.groq.com/keys),
`READYSPEC_PROVIDER=fixture|anthropic|gemini|groq`, `READYSPEC_MODEL` (default `claude-sonnet-5` /
`gemini-3.6-flash` / `openai/gpt-oss-120b`), `ANTHROPIC_BASE_URL`/`GEMINI_BASE_URL`/`GROQ_BASE_URL` (testing only),
`READYSPEC_ALLOWED_ROOTS` (path-delimited; fixtures always allowed), `READYSPEC_DB`,
`READYSPEC_MAX_CALLS|MAX_INPUT_TOKENS|MAX_OUTPUT_TOKENS|MAX_COST_USD`,
`READYSPEC_PRICE_IN_PER_MTOK|PRICE_OUT_PER_MTOK` (no prices are hard-coded).

## Known limitations

- Anthropic has never been exercised against a real API (see Status); Gemini and Groq have, but
  neither has completed a full model-dependent benchmark run end-to-end (Gemini: quota exhausted;
  Groq: this account's 8000 tokens/minute throughput ceiling, docs/decisions.md 21).
- Groq's free tier here caps at 8000 tokens/minute account-wide (not per-model): a single `analyze`
  call against even the small demo repository can exceed it, and no retry strategy fixes that case
  (only the 429/rate-limited case, which now honours `Retry-After`, docs/decisions.md 21).
- Retrieval is lexical + symbol-aware; symbol extraction is regex-based (TS/JS/Py/Md), not a parser.
- Follow-up rounds re-retrieve from ticket + answers; new excerpts (>=2 answer-introduced terms) need a second consent.
- Retrieval precision: 52.5% dev / 48% held-out v2 (recall 97.1% dev / 100% held-out v2, small samples); one dev
  miss is a vocabulary gap. v2 predates test-pairing and the hop cap (decisions.md 16, 18) and is frozen
  (contaminates on rerun).
- Snapshots keep file contents in the local SQLite file; deleting a session removes unshared snapshots.
- Snapshot creation is synchronous and capped (1500 files / 12 MB / 200 KB per file).
- Support check is lexical: it catches invented identifiers, not wrong meaning.

## Next actions

See docs/roadmap.md (ordered). Top item: run docs/live-validation.md with a real key (Anthropic, Gemini
or Groq — all three adapters exist now). Repo is public at https://github.com/ns-0437/readyspec (branch main; CI on
push). Retrieval changes after the heldout-v2 run contaminate it: write a v3 cohort first.

## Maintenance rule

Update this file whenever structure, commands, architectural decisions or important
constraints change. Never list unbuilt code as built or untested commands as working.
