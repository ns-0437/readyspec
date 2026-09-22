# ReadySpec — CLAUDE.md

Repository-aware agent: rough engineering ticket in, evidence-backed implementation
brief out. Personal portfolio project. Deeper docs: [docs/product.md](docs/product.md),
[docs/architecture.md](docs/architecture.md), [docs/decisions.md](docs/decisions.md),
[docs/plan.md](docs/plan.md).

## Status (update every milestone)

Milestones 1-5 built and checked: lint, typecheck, 156 tests, production build, and the UI driven
end to end in a browser. **Two things are NOT done:** (1) neither live-model path (Anthropic,
Gemini) has ever run against a real API (no credentials were available when either was built;
both are tested only against local mock servers), and (2) no model-dependent benchmark result
exists. Everything that runs today uses the labelled fixture provider (scripted output).
Benchmark: retrieval + static checklist are real; see evals/REPORT.md for what is and is not measured.

## Purpose, user, scope

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
Model adapters behind `src/server/llm/provider.ts`; Anthropic and Gemini, both via plain `fetch`
(no vendor SDKs), selected by `createProvider()`. A session pins one provider for its lifetime.

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
- `src/server/repository/` — `safe-fs` (root/allowlist/traversal), `filters` (exclusions, injection heuristics), `snapshot`, `symbols`, `search` (BM25 + symbol hops), `evidence` (ids, hashing, verification), `inspect`, `discover`, `types`.
- `src/server/llm/` — `provider` (interfaces, errors), `anthropic`, `gemini`, `fixture/` (scripted demo + mechanical fallback), `generate` (retries/validation/cancel), `budget`, `contexts`, `prompts/`, `index` (provider selection: explicit `READYSPEC_PROVIDER` wins; else key presence, Anthropic preferred if both set; else fixture).
- `src/server/workflow/` — `investigate` (stages 1-2 + disclosure), `stages` (analyze/clarify/brief/judge), `verify` + `support` (stage 6), `service` (session state machine, jobs), `export`, `errors`.
- `src/server/persistence/` — `db` (schema), `store` (typed access).
- `src/app/` — `page.tsx`, `sessions/[id]/page.tsx`, `api/**/route.ts`.
- `src/components/` — `Home`, `Workspace`, `TicketPanel`, `EvidenceExplorer` (+ traceability inspector), `BriefPanel`, `ActivityLog`, `Badges`, `api`.
- `fixtures/demo-repository/` — labelled DEMO TypeScript app (auth, notifications, preferences, tests) with planted secret, binary, generated file, conflicting docs and a prompt-injection doc. Has its own passing tests.
- `fixtures/repos/{shop-orders,team-tasks}/` — labelled evaluation repos (TypeScript, Python); shop-orders has runnable tests.
- `evals/` — `cases/*.json` (26 hand-authored: 13 dev, 7 held-out v1 contaminated, 6 held-out v2 clean), `runners/` (schema, score, systems, report, run, cases), `rubrics/human-rubric.md`, `results/`, `REPORT.md`.
- `tests/` — Vitest suites (repository safety, search/evidence, LLM layer + mock Anthropic/Gemini servers, verifier, service, API, edit/trace/export, eval scoring/case integrity).
- `scripts/live-smoke.ts` — live-path smoke test; `.github/workflows/ci.yml` — lint, typecheck, tests, fixture tests, deterministic eval, build.
- `.env.example` — every supported env var, commented out.
- `docs/` — product, architecture, decisions, evaluation, demo (90-second script), live-validation, roadmap, plan.

## Commands (all verified)

```
npm install
npm run dev            # http://localhost:3000 (fixture provider unless ANTHROPIC_API_KEY or GEMINI_API_KEY set)
npm run lint           # eslint
npm run typecheck      # tsc for app + fixtures
npm test               # vitest
npm run test:fixtures  # node --test on the demo + shop-orders fixtures' own tests
npm run check          # lint + typecheck + test
npm run build          # production build
npm run eval -- --provider fixture --set dev   # benchmark; --repeat N for variance; --set heldout-v2 ONCE after code freeze (v1 is contaminated)
npm run smoke:live     # first-contact live check (needs ANTHROPIC_API_KEY or GEMINI_API_KEY); see docs/live-validation.md
```

Config (env): `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`),
`READYSPEC_PROVIDER=fixture|anthropic|gemini`, `READYSPEC_MODEL` (default `claude-sonnet-5` /
`gemini-2.5-flash`), `ANTHROPIC_BASE_URL`/`GEMINI_BASE_URL` (testing only),
`READYSPEC_ALLOWED_ROOTS` (path-delimited; fixtures always allowed), `READYSPEC_DB`,
`READYSPEC_MAX_CALLS|MAX_INPUT_TOKENS|MAX_OUTPUT_TOKENS|MAX_COST_USD`,
`READYSPEC_PRICE_IN_PER_MTOK|PRICE_OUT_PER_MTOK` (no prices are hard-coded).

## Known limitations

- Neither live model (Anthropic, Gemini) ever exercised against a real API (see Status).
- Gemini's `responseSchema` support is a restricted subset of JSON Schema; `toGeminiSchema` strips
  known-unsupported keywords, but this is unverified against the live API (docs/decisions.md 14).
- Retrieval is lexical + symbol-aware; symbol extraction is regex-based (TS/JS/Py/Md), not a parser.
- Follow-up rounds re-retrieve from ticket + answers; new excerpts (>=2 answer-introduced terms) need a second consent.
- Retrieval precision: 57% dev / 48% held-out v2 (recall 96% dev / 100% held-out v2, small samples); one dev miss is a vocabulary gap.
- Snapshots keep file contents in the local SQLite file; deleting a session removes unshared snapshots.
- Snapshot creation is synchronous and capped (1500 files / 12 MB / 200 KB per file).
- Support check is lexical: it catches invented identifiers, not wrong meaning.

## Next actions

See docs/roadmap.md (ordered). Top item: run docs/live-validation.md with a real key (Anthropic or Gemini
— both adapters exist now). Repo is public at https://github.com/ns-0437/readyspec (branch main; CI on
push). Retrieval changes after the heldout-v2 run contaminate it: write a v3 cohort first.

## Maintenance rule

Update this file whenever structure, commands, architectural decisions or important
constraints change. Never list unbuilt code as built or untested commands as working.
