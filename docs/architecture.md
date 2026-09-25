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

`LlmProvider.complete(request) -> { text, usage }`. Four implementations, selected by
`createProvider()` (`src/server/llm/index.ts`) from env vars (priority anthropic > gemini > groq >
fixture, or explicit `READYSPEC_PROVIDER`); a session pins whichever one was selected at creation
(`service.ts` refuses to continue a job if the provider changes underneath it):

- `AnthropicProvider` — `fetch` against the Messages API; forces a single tool call whose input
  schema is the stage's JSON Schema (`tool_choice: {type: "tool", ...}`).
- `GeminiProvider` — `fetch` against `generateContent`; requests JSON directly via
  `generationConfig.responseMimeType: "application/json"` + `responseSchema` (Gemini's structured
  output has no separate "forced tool" step). The schema is passed through `toGeminiSchema`, which
  drops JSON Schema keywords (`$schema`, `additionalProperties`, `$ref`, ...) that Gemini's
  restricted OpenAPI-subset schema does not accept.
- `GroqProvider` — `fetch` against the OpenAI-compatible `/chat/completions`; requests JSON via
  `response_format: {type: "json_schema", strict: false}`. Unlike Gemini, no schema translation was
  needed live (it accepts standard JSON Schema); `strict: false` is deliberate, not a shortcut --
  Groq's `strict: true` constrained decoding requires every field `required` and every object
  `additionalProperties: false`, which fights this app's genuinely-optional schema fields the same
  way Gemini's schema needed active stripping (docs/decisions.md 21).
- `FixtureProvider` — scripted for the demonstration ticket and mechanical otherwise; it is
  labelled in the UI, the brief (`producedBy`), exports and evaluation reports.

All three real adapters share the same shape of error handling: the API key goes in a header (never
the URL or logs), 429/5xx are retryable, other 4xx are not, a malformed or contentless response is a
`ProviderError`, and a caller-aborted `AbortSignal` becomes `CancelledError`. A 429's `Retry-After`
header, when present, is parsed into `ProviderError.retryAfterMs` and honoured by the retry backoff
in `generate.ts` (added after Groq's free-tier throughput limit exposed that the old fixed
exponential backoff undershot a real `Retry-After` value by ~20x -- docs/decisions.md 21). Gemini and
Groq have each been exercised against their real API at least once (see README status for what that
did and didn't prove); Anthropic has not (no key). All three are covered by tests against a local
mock HTTP server (`tests/llm.test.ts`) that check request shape, response parsing, error
classification and that the API key is never echoed back in a surfaced error message.
