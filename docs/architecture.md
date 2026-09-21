# Architecture

## Staged workflow

```
select repo + ticket
      |
      v
1 Repository inspection   (local, deterministic)   snapshot -> inspect
2 Evidence retrieval      (local, deterministic)   BM25 + symbol hops -> bounded excerpts
      |
      |   disclosure: exactly which excerpts leave the machine; user consents
      v
3 Behavior analysis       (model)   observations + contradictions + missing decisions
4 Clarification           (model)   <= 5 ranked questions, suggestions, rounds <= 3
      |
      |   human answers / defers
      v
5 Brief generation        (model)   requirements, steps, tests, risks; then deterministic repairs
6 Verification            (code; optional model judge)   citations, support, traceability
      |
      v
   human review -> approve -> export
```

Stages 1, 2 and 6 never call a model. Between stages the data is a Zod-validated typed value
(`src/shared/schemas.ts`); model output that fails validation is retried with the error message,
up to a bound, then fails recoverably.

## Module boundaries

| Path | Responsibility | May import |
|---|---|---|
| `src/shared` | Schemas, pure helpers (trace, edit ops, secret patterns) | nothing server-side |
| `src/server/repository` | Snapshot, safe file access, filters, symbols, search, evidence | `shared` |
| `src/server/llm` | Provider adapters, prompts, budgets, structured generation | `shared` |
| `src/server/workflow` | Stage logic, verification, export, `SessionService` | all server modules |
| `src/server/persistence` | SQLite access, typed artifacts | `shared`, repository types |
| `src/app/api` | Parse body (Zod), call service, map errors to HTTP | `workflow` |
| `src/components` | Presentation and client state | `shared` only |

Prompts live in `src/server/llm/prompts/`; orchestration never builds prompt text.

## Repository access model

- The root must be absolute, exist, be a directory, not be a filesystem root, and sit inside an
  allowed root (`READYSPEC_ALLOWED_ROOTS`; the bundled fixtures are always allowed).
- The walk uses `lstat`; symlinks and junctions are recorded as excluded and never followed. Each
  file's real path is re-checked to lie inside the root before it is read.
- Excluded: secret files (`.env*`, keys, certificates, credentials), binaries (extension or NUL
  sniff), generated and minified files, lockfiles, `node_modules`/build output/`.git`, files over
  200 KB, files whose content matches a secret pattern (recorded by name and reason only, content
  discarded), and anything past the file/byte caps (the snapshot is marked truncated).
- Nothing from the repository is executed. Dependencies are never installed. The repository is
  never written to.
- The snapshot is content-addressed (`sha256` over sorted path + file hash), stored in SQLite with
  file contents, and pinned per session. The commit is read from `.git` metadata without running
  git. Evidence is validated against the stored snapshot, not the live directory.

## Evidence

`EvidenceRef = { id, path, startLine, endLine, contentHash }`. The id is derived from path and
range, so it is stable across rounds. `verifyEvidenceRef` checks the file exists, the range is
inside it and the lines still hash to the recorded value. This proves the citation is *valid*.
Whether it *supports* the claim is a separate check (`workflow/support.ts`): identifiers, constants,
dotted accesses, paths and quoted literals in the claim must appear in the cited lines. This
catches invented code and mis-citations; it cannot judge meaning, so "supported" is deliberately
modest. An optional model judge (live provider only) adds supplementary verdicts that never gate
approval.

## Verification checks (deterministic)

Errors (block approval): unknown/invalid citation, observed statement without evidence,
unsupported observed claim, criterion without a test, dangling reference, duplicate id,
modify-component missing from the snapshot, decision not recorded / differing from the recorded
answer / deferred-but-decided, unresolved question dropped from the brief.
Warnings: weak support, observation phrased like a proposal, criterion without component or
evidence, unlinked step, uncovered criterion, unrecorded decision reference.

## Session state machine

```
created -> inspecting -> awaiting_consent -> analyzing -> awaiting_answers -> briefing -> review -> approved
                                   \___________ failed / cancelled (recoverable: resume) ___________/
review --follow-up--> analyzing --> awaiting_answers (round n+1) | review (no new questions)
review --follow-up naming unseen code--> awaiting_consent (new excerpts only) --consent or skip--> analyzing
approved --edit--> review (approval cleared)
```

Jobs run in-process in the background, one per session; the UI polls. `cancel` aborts the
`AbortSignal` threaded through every model call. A failed or cancelled session keeps evidence,
analysis and decisions; `resume` re-runs only the failed stage.

## Reliability and limits

Per-session ceilings on model calls, input tokens, output tokens and (if prices are supplied)
cost; each retry counts against them and they are checked before every call. Retries are bounded
(default 2) with exponential backoff for transient provider errors and re-prompts for invalid
JSON or schema failures. Errors and log lines pass through `redactSecrets`.

## Trust boundaries

Repository text and tickets are untrusted data. In prompts they sit inside delimited data tags
(closing-tag spoofing is neutralised) under a system prompt that says so; the model is given no
tools, so text cannot cause an action. Injection heuristics flag instruction-like text in the UI
and log. The application, not the model, records decisions, imposes them on the brief, and
approves. `LlmRequest.context` (typed stage input) is read only by the fixture provider; real
providers see only the rendered prompt.

## Persistence (SQLite via `node:sqlite`)

`sessions`, `snapshots` + `snapshot_files`, `artifacts` (kind, round -> validated JSON),
`decisions`, `activity`, `usage`. Artifacts are Zod-parsed on read and write.

## Provider layer

`LlmProvider.complete(request) -> { text, usage }`. `AnthropicProvider` uses `fetch` against the
Messages API and forces a single tool call whose input schema is the stage's JSON Schema.
`FixtureProvider` is scripted for the demonstration ticket and mechanical otherwise; it is
labelled in the UI, the brief (`producedBy`), exports and evaluation reports.
