# ReadySpec

A repository-aware agent that turns a rough engineering ticket into an **evidence-backed
implementation brief**. It reads the actual code, finds the decisions the ticket leaves open,
asks a few useful questions, and produces a plan an engineer can review and implement, where
every statement about existing behavior points at code and every proposed change connects to a
requirement and a test.

> **Demonstration data.** The bundled repositories under `fixtures/` are fictional code written
> for this project. They are not BetterMe's code or system.

## Honest status

| Works and is tested | Not done / not validated |
|---|---|
| Full flow: select repo, investigate, consent, clarify, brief, verify, edit, approve, export | **Live model path has not been run against the real API** (no credentials were available). The Anthropic adapter is tested only against a local mock server. |
| Safe read-only repository snapshots; pinned, content-addressed evidence | **No model-quality benchmark result exists yet.** The harness, 20 cases and human rubric are ready; the single-prompt vs staged comparison is unmeasured. |
| Deterministic verifier (citations, support, traceability, decisions) | Support check is lexical, not semantic |
| 139 tests, lint, typecheck, production build | Retrieval is lexical; precision is about 56% (see the report) |
| Deterministic retrieval + static-checklist benchmark results | |

Everything you can run today without a key uses the **fixture provider**: scripted output for the
demonstration ticket and a mechanical fallback elsewhere. It is labelled in the UI, in the
brief, in exports and in evaluation reports. It is not a language model.

## Quick start

Requires Node 22.13 or newer (uses the built-in `node:sqlite`).

```bash
npm install
npm run dev
```

Open http://localhost:3000. The demonstration repository and ticket ("Let users pause
notifications while they are away.") are pre-filled. Click **Investigate repository**, review the
disclosure, consent, answer the questions, and open the brief. Click an acceptance criterion to
see its evidence, affected components and proposed tests together. A walkthrough for a 90-second
recording is in [docs/demo.md](docs/demo.md).

### Use a real model

```bash
# PowerShell:  $env:ANTHROPIC_API_KEY = "..."
export ANTHROPIC_API_KEY=...        # server-side only; never sent to the browser
export READYSPEC_MODEL=claude-sonnet-5   # optional; this is the default
npm run dev
```

Optional limits and pricing (no prices are hard-coded, so cost shows as unknown until you set them):

| Variable | Default | Purpose |
|---|---|---|
| `READYSPEC_PROVIDER` | `anthropic` if a key is set, else `fixture` | Force a provider |
| `READYSPEC_MAX_CALLS` | 14 | Model calls per session (retries count) |
| `READYSPEC_MAX_INPUT_TOKENS` / `MAX_OUTPUT_TOKENS` | 200000 / 60000 | Per-session token ceilings |
| `READYSPEC_MAX_COST_USD` | unset | Cost ceiling (needs prices) |
| `READYSPEC_PRICE_IN_PER_MTOK` / `PRICE_OUT_PER_MTOK` | unset | USD per million tokens |
| `READYSPEC_ALLOWED_ROOTS` | fixtures only | Extra repository roots (path-delimited) |
| `READYSPEC_DB` | `data/readyspec.db` | SQLite file |

To analyse your own repository, add its parent directory to `READYSPEC_ALLOWED_ROOTS`. ReadySpec
only reads it. If you run it against a real model, the excerpts listed on the consent screen are
sent to Anthropic; nothing else from the repository is.

## What it does

1. **Inspect** the repository into a read-only, content-addressed snapshot (symlinks never
   followed; secrets, binaries, generated and oversized files excluded).
2. **Retrieve** relevant code with lexical, symbol-aware search into bounded excerpts.
3. **Disclose** exactly what would be sent to a model and wait for consent.
4. **Analyze** current behavior (with citations), contradictions and open decisions.
5. **Ask** at most five ranked questions per round, with suggested answers that are only options.
6. **Brief**: requirements, existing behavior, decisions, open questions, criteria, components,
   steps, tests, risks and assumptions, linked together.
7. **Verify** deterministically, then a human reviews, edits, approves and exports.

Content is always labelled **observed** (evidence-backed), **proposed**, **assumed** or
**unresolved**. Design details: [docs/architecture.md](docs/architecture.md). Product intent:
[docs/product.md](docs/product.md). Decisions and measured trade-offs:
[docs/decisions.md](docs/decisions.md).

## Reliability and safety

Repository text and tickets are treated as untrusted data (fenced in prompts, injection heuristics
flag them, the model has no tools). Nothing from a repository is executed or installed. Reads are
confined to allowed roots. Credentials stay server-side and are redacted from logs and errors.
Every call is bounded (calls, tokens, cost, retries) and cancellable; failed or cancelled sessions
keep their evidence and answers and can resume. Approval is a human action and requires passing
verification.

## Commands

```bash
npm run dev            # development server
npm run build          # production build
npm run lint           # eslint
npm run typecheck      # tsc (app and fixtures)
npm test               # 139 vitest tests
npm run test:fixtures  # the fixture repositories' own tests (node --test)
npm run check          # lint + typecheck + test
npm run eval -- --provider fixture --set dev   # benchmark (see below)
```

## Evaluation

Twenty hand-authored tickets over three small fixture repositories (TypeScript and Python), seven
held out, compared across a static checklist, a single prompt and the staged workflow.
[evals/REPORT.md](evals/REPORT.md) is candid about what exists: retrieval and checklist results
are real; the model-dependent comparison needs a live run and is not yet measured. Method and
threats to validity: [docs/evaluation.md](docs/evaluation.md). Human rubric:
[evals/rubrics/human-rubric.md](evals/rubrics/human-rubric.md).

## Repository layout

```
src/shared        schemas and pure helpers
src/server/       repository (snapshot, search, evidence), llm, workflow, persistence
src/app/api       thin route handlers
src/components    UI
fixtures/         demo-repository and evaluation repositories (fictional)
evals/            cases, rubric, runner, results, report
tests/            vitest suites
docs/             product, architecture, decisions, evaluation, demo, plan
CLAUDE.md         guide for future coding sessions
```

## Known limitations

Single-user local tool (no authentication); one job per session in-process; snapshot creation is
synchronous and capped at 1500 files / 12 MB; symbol extraction is regex-based; follow-up rounds
reuse the original evidence; the `node:sqlite` module prints an experimental warning. Snapshots store the
contents of every readable file in the local SQLite file (`data/`, git-ignored); deleting a session
removes them unless another session pins the same snapshot.
