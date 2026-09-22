import path from "node:path";
import {
  MAX_ROUNDS,
  type AnswerInput,
  type BehaviorAnalysis,
  type Brief,
  type BriefContent,
  type ClarificationRound,
  type EvidenceItem,
  type SessionDetail,
  type SessionError,
  type SessionLimits,
  type SessionSummary,
  type SupportResult,
} from "@/shared/schemas";
import { Budget, limitsFromEnv } from "@/server/llm/budget";
import { createProvider } from "@/server/llm";
import { BudgetExceededError, CancelledError, type LlmProvider, type StageName } from "@/server/llm/provider";
import { StageError } from "@/server/llm/generate";
import { getStore, type Store } from "@/server/persistence/store";
import { createSnapshot } from "@/server/repository/snapshot";
import { allowedRoots, assertRepositoryAllowed, isInside, RepositoryAccessError, resolveRepositoryRoot } from "@/server/repository/safe-fs";
import { redactSecrets } from "@/shared/redact";
import { ConflictError, NotFoundError, RuleViolationError } from "./errors";
import { buildDisclosure, findNewEvidence, investigate } from "./investigate";
import { runAnalyze, runBrief, runClarify, runJudge, type StageEnv } from "./stages";
import { verifyBrief } from "./verify";

export interface ServiceDeps {
  store: Store;
  providerFactory: () => LlmProvider;
  /** Extra allowed repository roots (in addition to READYSPEC_ALLOWED_ROOTS). */
  defaultRoots: string[];
  limits: SessionLimits;
  backoffMs?: number;
}

interface Job {
  controller: AbortController;
  promise: Promise<void>;
}

const RECOVERABLE_STAGES = ["analyze", "clarify", "brief"] as const;

export class SessionService {
  private readonly jobs = new Map<string, Job>();

  constructor(private readonly deps: ServiceDeps) {}

  private get store() {
    return this.deps.store;
  }

  /* ------------------------------ create + investigate ------------------------------ */

  /** Selects the repository, pins a snapshot, and runs the deterministic stages (no model call). */
  createSession(repoPath: string, ticket: string): SessionSummary {
    const real = resolveRepositoryRoot(repoPath);
    assertRepositoryAllowed(real, allowedRoots(this.deps.defaultRoots));
    const snapshot = createSnapshot(real);
    this.store.saveSnapshot(snapshot);
    const provider = this.deps.providerFactory();
    const demoRoot = this.deps.defaultRoots.map((r) => path.join(r, "demo-repository"));
    const session = this.store.createSession({
      title: ticket.trim().split("\n")[0]?.slice(0, 90) ?? "Untitled ticket",
      repoPath: real,
      repoLabel: path.basename(real),
      ticket: ticket.trim(),
      provider: provider.info,
      isDemo: demoRoot.some((d) => isInside(d, real)),
    });
    const id = session.id;
    this.store.setSnapshotId(id, snapshot.id);
    this.store.setStatus(id, "inspecting");
    this.store.log(id, "inspect", "info", `Pinned snapshot ${snapshot.id.slice(0, 12)}${snapshot.commit ? ` (commit ${snapshot.commit.slice(0, 10)})` : " (not a git checkout; content-hash snapshot)"}: ${snapshot.files.size} readable files, ${snapshot.excluded.length} excluded.`);
    for (const ex of snapshot.excluded.slice(0, 20)) this.store.log(id, "inspect", "info", `Excluded ${ex.path} (${ex.reason})`);
    if (snapshot.truncated) this.store.log(id, "inspect", "warn", "Snapshot hit a size or file-count limit; some files were not read.");

    const inv = investigate(snapshot, session.ticket);
    this.store.putArtifact(id, "inspection", inv.inspection);
    this.store.putArtifact(id, "evidence", inv.evidence);
    this.store.putArtifact(id, "disclosure", buildDisclosure(snapshot, inv.evidence, session.ticket, provider));
    this.store.log(id, "retrieve", "info", `Search terms: ${inv.retrieval.query.filter((q) => q.origin === "ticket").map((q) => q.term).join(", ")}`);
    this.store.log(id, "retrieve", "info", `Retrieved ${inv.evidence.length} excerpt(s), ${inv.retrieval.totalChars} characters.`);
    for (const e of inv.evidence) {
      if (e.injectionFlags.length) this.store.log(id, "retrieve", "warn", `Instruction-like text in ${e.path}:${e.startLine}-${e.endLine} (${e.injectionFlags.join(", ")}). Treated as untrusted data, never as instructions.`);
    }
    if (inv.evidence.length === 0) this.store.log(id, "retrieve", "warn", "No relevant code was found for this ticket; the agent will have to say it cannot establish current behavior.");
    this.store.setStatus(id, "awaiting_consent");
    return this.store.getSession(id)!;
  }

  /* ------------------------------ job plumbing ------------------------------ */

  isRunning(id: string): boolean {
    return this.jobs.has(id);
  }

  waitForIdle(id: string): Promise<void> {
    return this.jobs.get(id)?.promise ?? Promise.resolve();
  }

  private requireSession(id: string): SessionSummary {
    const s = this.store.getSession(id);
    if (!s) throw new NotFoundError();
    return s;
  }

  private startJob(id: string, stage: string, during: "analyzing" | "briefing", work: (env: StageEnv, setStage: (s: string) => void) => Promise<void>): void {
    if (this.jobs.has(id)) throw new ConflictError("A job is already running for this session");
    const session = this.requireSession(id);
    const provider = this.deps.providerFactory();
    if (provider.info.label !== session.provider.label) {
      throw new ConflictError(`Model provider changed since this session was created (${session.provider.label} -> ${provider.info.label}). Start a new session so the disclosure you approved still applies.`);
    }
    const controller = new AbortController();
    const env: StageEnv = {
      provider,
      budget: new Budget(this.deps.limits, this.store.getUsage(id)),
      signal: controller.signal,
      backoffMs: this.deps.backoffMs,
      onUsage: (s: StageName, u) => this.store.recordUsage(id, s, u),
      onEvent: (s, level, message) => this.store.log(id, s, level, message),
    };
    this.store.setStatus(id, during);
    this.store.log(id, stage, "info", `Started ${stage} with ${provider.info.label}.`);
    const job: Job = { controller, promise: Promise.resolve() };
    this.jobs.set(id, job);
    let current = stage; // the stage that was running when a failure happens, so resume re-runs only that
    job.promise = (async () => {
      try {
        await work(env, (s) => {
          current = s;
        });
      } catch (e) {
        this.fail(id, current, e);
      } finally {
        this.jobs.delete(id);
      }
    })();
  }

  private fail(id: string, stage: string, e: unknown): void {
    let err: SessionError;
    if (e instanceof CancelledError) {
      err = { stage, message: "Cancelled by user. Progress so far is kept; resume when ready.", recoverable: true };
      this.store.setStatus(id, "cancelled", err);
      this.store.log(id, stage, "warn", err.message);
      return;
    }
    if (e instanceof BudgetExceededError) err = { stage, message: `${e.message}. Raise the limit (READYSPEC_MAX_* env) and resume.`, recoverable: true };
    else if (e instanceof StageError) err = { stage, message: e.message, recoverable: e.recoverable };
    else err = { stage, message: `Unexpected error: ${redactSecrets((e as Error)?.message ?? String(e))}`, recoverable: false };
    this.store.setStatus(id, "failed", err);
    this.store.log(id, stage, "error", err.message);
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.controller.abort();
    return true;
  }

  /* ------------------------------ analysis + clarification ------------------------------ */

  /** User consented to send the disclosed excerpts. Runs behavior analysis and the first clarification round. */
  startAnalysis(id: string): void {
    const s = this.requireSession(id);
    if (s.status === "failed" || s.status === "cancelled") return this.resume(id); // re-runs only the stage that failed
    if (s.status !== "awaiting_consent") throw new ConflictError(`Cannot start analysis while session is ${s.status}`);
    if ((this.store.getArtifact(id, "pending_evidence") ?? []).length > 0) return this.acceptFollowUpEvidence(id);
    this.startJob(id, "analyze", "analyzing", (env, setStage) => this.pipeline(id, env, "analyze", setStage));
  }

  private async pipeline(id: string, env: StageEnv, from: "analyze" | "clarify", setStage: (s: string) => void): Promise<void> {
    const session = this.requireSession(id);
    let evidence = this.store.getArtifact(id, "evidence") ?? [];
    const inspection = this.store.getArtifact(id, "inspection");
    if (!inspection) throw new StageError("Inspection artifact missing", false);
    let analysis = this.store.getArtifact(id, "analysis");

    if (from === "analyze" || !analysis) {
      analysis = await runAnalyze(env, { ticket: session.ticket, evidence, inspection });
      evidence = evidence.map((e) => ({ ...e, explanation: analysis?.evidenceNotes[e.id] ?? e.explanation }));
      this.store.putArtifact(id, "evidence", evidence);
      this.store.putArtifact(id, "analysis", analysis);
      this.store.log(id, "analyze", "info", `Analysis: ${analysis.observations.length} observed, ${analysis.contradictions.length} contradiction(s), ${analysis.missingDecisions.length} open decision(s), ${analysis.insufficientEvidence.length} gap(s).`);
    }
    setStage("clarify");
    await this.clarifyRound(id, env, session.round, analysis, evidence);
  }

  private async clarifyRound(id: string, env: StageEnv, round: number, analysis: BehaviorAnalysis, evidence: EvidenceItem[]): Promise<void> {
    const session = this.requireSession(id);
    const priorRounds = this.store.listRounds(id).filter((r) => r.round < round);
    const out = await runClarify(env, {
      ticket: session.ticket,
      analysis,
      evidence,
      decisions: this.store.listDecisions(id),
      priorQuestions: priorRounds.flatMap((r) => r.questions),
      round,
    });
    this.store.putArtifact(id, "clarification", { round, questions: out.questions, note: out.note }, round);
    this.store.log(id, "clarify", "info", out.questions.length ? `Round ${round}: ${out.questions.length} question(s) for you.` : `Round ${round}: no further questions${out.note ? ` (${out.note})` : ""}.`);
    this.store.setStatus(id, "awaiting_answers");
  }

  submitAnswers(id: string, answers: AnswerInput[]): void {
    const s = this.requireSession(id);
    if (s.status !== "awaiting_answers") throw new ConflictError(`Cannot record answers while session is ${s.status}`);
    const round = this.currentRound(id);
    if (!round) throw new ConflictError("No clarification round is open");
    const byId = new Map(round.questions.map((q) => [q.id, q]));
    for (const a of answers) {
      const q = byId.get(a.questionId);
      if (!q) throw new RuleViolationError(`Unknown question ${a.questionId} for round ${round.round}`);
      if (a.source !== "deferred" && a.answer.trim() === "") throw new RuleViolationError(`Answer for ${a.questionId} is empty; defer it instead`);
      if (a.source === "suggestion_accepted" && !q.suggestedAnswers.some((x) => x.text.trim() === a.answer.trim())) {
        throw new RuleViolationError(`Answer for ${a.questionId} is marked as an accepted suggestion but matches none`);
      }
    }
    const now = new Date().toISOString();
    for (const a of answers) {
      const q = byId.get(a.questionId)!;
      this.store.putDecision(id, { questionId: q.id, question: q.text, round: round.round, answer: a.source === "deferred" ? "" : a.answer.trim(), source: a.source, answeredAt: now });
    }
    this.store.log(id, "clarify", "info", `Recorded ${answers.length} answer(s) (${answers.filter((a) => a.source === "deferred").length} deferred).`);
  }

  private currentRound(id: string): ClarificationRound | null {
    const r = this.store.getSession(id)?.round ?? 1;
    return this.store.getArtifact(id, "clarification", r);
  }

  /** Request another clarification round from the review screen. Answers and evidence are preserved. */
  startFollowUp(id: string): { needsConsent: boolean } {
    const s = this.requireSession(id);
    if (s.status !== "review") throw new ConflictError("Follow-up questions can be requested while reviewing a draft brief");
    if (s.round >= MAX_ROUNDS) throw new RuleViolationError(`At most ${MAX_ROUNDS} clarification rounds are allowed`);
    if (!this.store.getArtifact(id, "analysis")) throw new ConflictError("Analysis is missing");
    if (this.jobs.has(id)) throw new ConflictError("A job is already running for this session");
    const next = s.round + 1;

    // The human's answers may point at code the first retrieval never saw. New excerpts need new consent.
    const snapshot = this.store.loadSnapshot(this.store.getSnapshotId(id)!);
    const existing = this.store.getArtifact(id, "evidence") ?? [];
    const answers = this.store.listDecisions(id).filter((d) => d.source !== "deferred").map((d) => d.answer).join("\n");
    const fresh = snapshot ? findNewEvidence(snapshot, s.ticket, answers, existing) : [];
    if (snapshot && fresh.length > 0) {
      const provider = this.deps.providerFactory();
      if (provider.info.label !== s.provider.label) throw new ConflictError(`Model provider changed since this session was created (${s.provider.label} -> ${provider.info.label}). Start a new session.`);
      this.store.setRound(id, next);
      this.store.putArtifact(id, "pending_evidence", fresh);
      this.store.putArtifact(id, "disclosure", buildDisclosure(snapshot, fresh, s.ticket, provider, "followup"));
      this.store.setStatus(id, "awaiting_consent");
      this.store.log(id, "retrieve", "info", `Round ${next}: your answers point at ${fresh.length} excerpt(s) not yet seen (${[...new Set(fresh.map((e) => e.path))].join(", ")}). Waiting for consent before sending them.`);
      return { needsConsent: true };
    }
    this.startJob(id, "clarify", "analyzing", (env) => this.followUpJob(id, env, next, false));
    return { needsConsent: false };
  }

  /** Runs the next clarification round; when `merge`, first adds the consented new excerpts to the evidence set. */
  private async followUpJob(id: string, env: StageEnv, round: number, merge: boolean): Promise<void> {
    this.store.setRound(id, round); // only once the job has really started (startJob may refuse)
    const analysis = this.store.getArtifact(id, "analysis");
    if (!analysis) throw new StageError("Analysis is missing", false);
    let evidence = this.store.getArtifact(id, "evidence") ?? [];
    const pending = this.store.getArtifact(id, "pending_evidence") ?? [];
    if (merge && pending.length) {
      const known = new Set(evidence.map((e) => e.id));
      evidence = [...evidence, ...pending.filter((e) => !known.has(e.id))];
      this.store.putArtifact(id, "evidence", evidence);
      this.store.log(id, "retrieve", "info", `Added ${pending.length} consented excerpt(s); evidence set is now ${evidence.length}.`);
    }
    this.clearPending(id, evidence);
    await this.clarifyRound(id, env, round, analysis, evidence);
    const r = this.store.getArtifact(id, "clarification", round);
    if (r && r.questions.length === 0) this.store.setStatus(id, "review");
  }

  /** Drops pending excerpts and restores the disclosure to describe the whole evidence set. */
  private clearPending(id: string, evidence: EvidenceItem[]): void {
    this.store.deleteArtifact(id, "pending_evidence");
    const snapshot = this.store.loadSnapshot(this.store.getSnapshotId(id)!);
    if (snapshot) this.store.putArtifact(id, "disclosure", buildDisclosure(snapshot, evidence, this.requireSession(id).ticket, this.deps.providerFactory()));
  }

  /** Consent given for new follow-up excerpts. */
  private acceptFollowUpEvidence(id: string): void {
    const s = this.requireSession(id);
    this.startJob(id, "clarify", "analyzing", (env) => this.followUpJob(id, env, s.round, true));
  }

  /** The user declines the new excerpts: continue the round with the evidence already consented to. */
  declineFollowUpEvidence(id: string): void {
    const s = this.requireSession(id);
    if (s.status !== "awaiting_consent" || !(this.store.getArtifact(id, "pending_evidence") ?? []).length) {
      throw new ConflictError("There are no pending excerpts to decline");
    }
    this.store.log(id, "retrieve", "info", "New excerpts declined; continuing with the evidence already sent.");
    this.startJob(id, "clarify", "analyzing", (env) => this.followUpJob(id, env, s.round, false));
  }

  /* ------------------------------ brief ------------------------------ */

  startBrief(id: string): void {
    const s = this.requireSession(id);
    const resumable = (s.status === "failed" || s.status === "cancelled") && this.store.getArtifact(id, "clarification", s.round);
    if (s.status !== "awaiting_answers" && !resumable) throw new ConflictError(`Cannot generate a brief while session is ${s.status}`);
    const round = this.currentRound(id);
    if (!round) throw new ConflictError("No clarification round is open");
    const decided = new Set(this.store.listDecisions(id).map((d) => d.questionId));
    const missing = round.questions.filter((q) => !decided.has(q.id));
    if (missing.length) throw new RuleViolationError(`Answer or defer every question first (${missing.length} outstanding)`);
    this.startJob(id, "brief", "briefing", (env) => this.briefJob(id, env));
  }

  private async briefJob(id: string, env: StageEnv): Promise<void> {
    const session = this.requireSession(id);
    const snapshot = this.store.loadSnapshot(this.store.getSnapshotId(id)!);
    const analysis = this.store.getArtifact(id, "analysis");
    const inspection = this.store.getArtifact(id, "inspection");
    if (!snapshot || !analysis || !inspection) throw new StageError("Session artifacts missing; cannot generate a brief", false);
    const evidence = this.store.getArtifact(id, "evidence") ?? [];
    const rounds = this.store.listRounds(id);
    const decisions = this.store.listDecisions(id);

    const { content, repairs } = await runBrief(env, { ticket: session.ticket, analysis, evidence, decisions, rounds, inspection });
    for (const r of repairs) this.store.log(id, "brief", "warn", `Brief repaired deterministically: ${r}.`);
    const previous = this.store.getArtifact(id, "brief");
    const brief: Brief = { ...content, status: "draft", approval: null, revision: (previous?.revision ?? 0) + 1, producedBy: { kind: env.provider.info.kind, label: env.provider.info.label } };
    this.store.putArtifact(id, "brief", brief);
    this.store.log(id, "brief", "info", `Brief revision ${brief.revision}: ${brief.acceptanceCriteria.length} criteria, ${brief.components.length} components, ${brief.tests.length} tests, ${brief.openQuestions.length} open question(s).`);

    let modelSupport: SupportResult[] | undefined;
    if (env.provider.info.kind !== "fixture") {
      try {
        const evById = new Map(evidence.map((e) => [e.id, e]));
        const items = [
          ...brief.existingBehavior.map((o) => ({ itemId: o.id, itemType: "observation", statement: o.statement, evidenceIds: o.evidenceIds })),
          ...brief.acceptanceCriteria.filter((c) => c.evidenceIds.length).map((c) => ({ itemId: c.id, itemType: "criterion", statement: c.text, evidenceIds: c.evidenceIds })),
        ].filter((i) => i.evidenceIds.some((e) => evById.has(e)));
        modelSupport = await runJudge(env, { items, evidence });
      } catch (e) {
        if (e instanceof CancelledError) throw e;
        this.store.log(id, "verify", "warn", "Model support judge failed; continuing with deterministic checks only.");
      }
    }
    this.verifyAndStore(id, brief, modelSupport);
    this.store.setStatus(id, "review");
  }

  private verifyAndStore(id: string, brief: Brief, modelSupport?: SupportResult[]) {
    const snapshot = this.store.loadSnapshot(this.store.getSnapshotId(id)!)!;
    const report = verifyBrief({
      brief,
      revision: brief.revision,
      evidence: this.store.getArtifact(id, "evidence") ?? [],
      snapshot,
      questions: this.store.listRounds(id).flatMap((r) => r.questions),
      decisions: this.store.listDecisions(id),
      modelSupport,
    });
    this.store.putArtifact(id, "verification", report);
    const errors = report.issues.filter((i) => i.severity === "error").length;
    const warnings = report.issues.length - errors;
    this.store.log(id, "verify", errors ? "warn" : "info", `Verification of revision ${brief.revision}: ${report.citations.valid}/${report.citations.checked} citations valid, ${errors} error(s), ${warnings} warning(s).`);
    return report;
  }

  editBrief(id: string, content: BriefContent, baseRevision: number): Brief {
    const s = this.requireSession(id);
    if (s.status !== "review" && s.status !== "approved") throw new ConflictError(`Cannot edit the brief while session is ${s.status}`);
    const current = this.store.getArtifact(id, "brief");
    if (!current) throw new ConflictError("There is no brief to edit");
    if (current.revision !== baseRevision) throw new ConflictError(`Brief changed (revision ${current.revision}); reload before editing`);
    const next: Brief = { ...content, status: "draft", approval: null, revision: current.revision + 1, producedBy: current.producedBy };
    this.store.putArtifact(id, "brief", next);
    this.store.log(id, "review", "info", `Brief edited by a human (revision ${next.revision}).${current.status === "approved" ? " Earlier approval was cleared." : ""}`);
    this.verifyAndStore(id, next);
    if (s.status === "approved") this.store.setStatus(id, "review");
    return next;
  }

  approve(id: string, input: { reviewer: string; note: string; acknowledgeOpenItems: boolean }): Brief {
    const s = this.requireSession(id);
    if (s.status !== "review") throw new ConflictError(`Cannot approve while session is ${s.status}`);
    const brief = this.store.getArtifact(id, "brief");
    const report = this.store.getArtifact(id, "verification");
    if (!brief || !report) throw new ConflictError("There is no verified brief to approve");
    if (report.briefRevision !== brief.revision) throw new RuleViolationError("Verification is out of date for this revision; edit or regenerate first");
    if (!report.passed) throw new RuleViolationError("Verification found errors; fix or remove the flagged items before approving");
    if (brief.openQuestions.length > 0 && !input.acknowledgeOpenItems) throw new RuleViolationError("The brief has unresolved questions; acknowledge them explicitly to approve");
    const approved: Brief = { ...brief, status: "approved", approval: { approvedAt: new Date().toISOString(), reviewer: input.reviewer.trim(), note: input.note.trim() } };
    this.store.putArtifact(id, "brief", approved);
    this.store.setStatus(id, "approved");
    this.store.log(id, "review", "info", `Approved by ${approved.approval!.reviewer}${brief.openQuestions.length ? ` with ${brief.openQuestions.length} unresolved item(s) acknowledged` : ""}.`);
    return approved;
  }

  /** Re-run the failed or cancelled stage. Earlier artifacts and all decisions are kept. */
  resume(id: string): void {
    const s = this.requireSession(id);
    if (s.status !== "failed" && s.status !== "cancelled") throw new ConflictError("Only failed or cancelled sessions can be resumed");
    const err = this.store.getError(id);
    if (!err?.recoverable) throw new RuleViolationError("This failure is not recoverable; start a new session");
    if (!(RECOVERABLE_STAGES as readonly string[]).includes(err.stage)) throw new RuleViolationError(`Cannot resume stage ${err.stage}`);
    if (err.stage === "analyze") return this.startJob(id, "analyze", "analyzing", (env, setStage) => this.pipeline(id, env, "analyze", setStage));
    if (err.stage === "clarify") {
      return this.startJob(id, "clarify", "analyzing", async (env, setStage) => {
        const analysis = this.store.getArtifact(id, "analysis");
        if (!analysis) return this.pipeline(id, env, "analyze", setStage);
        await this.clarifyRound(id, env, this.requireSession(id).round, analysis, this.store.getArtifact(id, "evidence") ?? []);
      });
    }
    return this.startJob(id, "brief", "briefing", (env) => this.briefJob(id, env));
  }

  /* ------------------------------ read ------------------------------ */

  getDetail(id: string): SessionDetail | null {
    const session = this.store.getSession(id);
    if (!session) return null;
    return {
      session,
      error: this.store.getError(id),
      running: this.jobs.has(id),
      inspection: this.store.getArtifact(id, "inspection"),
      evidence: this.store.getArtifact(id, "evidence") ?? [],
      pendingEvidence: this.store.getArtifact(id, "pending_evidence") ?? [],
      disclosure: this.store.getArtifact(id, "disclosure"),
      analysis: this.store.getArtifact(id, "analysis"),
      rounds: this.store.listRounds(id),
      decisions: this.store.listDecisions(id),
      brief: this.store.getArtifact(id, "brief"),
      verification: this.store.getArtifact(id, "verification"),
      activity: this.store.listActivity(id),
      usage: this.store.getUsage(id),
      limits: this.deps.limits,
    };
  }

  list(): SessionSummary[] {
    return this.store.listSessions();
  }

  delete(id: string): void {
    if (this.jobs.has(id)) throw new ConflictError("Cancel the running job before deleting the session");
    this.requireSession(id);
    this.store.deleteSession(id);
  }
}

export function defaultRoots(): string[] {
  return [path.join(process.cwd(), "fixtures")];
}

export function getService(): SessionService {
  const g = globalThis as unknown as { __readyspecService?: SessionService };
  if (!g.__readyspecService) {
    g.__readyspecService = new SessionService({ store: getStore(), providerFactory: () => createProvider(), defaultRoots: defaultRoots(), limits: limitsFromEnv() });
  }
  return g.__readyspecService;
}

export { RepositoryAccessError };
