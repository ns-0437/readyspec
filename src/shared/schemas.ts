import { z } from "zod";

/** The four kinds of statement ReadySpec distinguishes everywhere (UI, brief, verification). */
export const ContentKind = z.enum(["observed", "proposed", "assumed", "unresolved"]);
export type ContentKind = z.infer<typeof ContentKind>;

export const MAX_QUESTIONS_PER_ROUND = 5;
export const MAX_ROUNDS = 3;

/* ------------------------------ evidence ------------------------------ */

/** A pointer into an immutable snapshot. `contentHash` = sha256 of the cited lines. */
export const EvidenceRef = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  contentHash: z.string().length(64),
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

export const EvidenceItem = EvidenceRef.extend({
  snapshotId: z.string(),
  language: z.string(),
  excerpt: z.string(),
  symbol: z.string().nullable(),
  score: z.number(),
  matchedTerms: z.array(z.string()),
  /** Why the retriever picked it (deterministic). */
  retrievalReason: z.string(),
  /** Set by the behavior-analysis stage; may be empty until then. */
  explanation: z.string().default(""),
  /** Instruction-like text detected in the excerpt (prompt-injection heuristics). */
  injectionFlags: z.array(z.string()).default([]),
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

/* ---------------------------- repository ---------------------------- */

export const ExcludedFile = z.object({ path: z.string(), reason: z.string() });
export type ExcludedFile = z.infer<typeof ExcludedFile>;

export const InspectionResult = z.object({
  snapshotId: z.string(),
  commit: z.string().nullable(),
  fileCount: z.number().int(),
  totalBytes: z.number().int(),
  languages: z.array(z.object({ language: z.string(), files: z.number().int() })),
  manifests: z.array(z.string()),
  entryPoints: z.array(z.string()),
  testFiles: z.array(z.string()),
  instructionFiles: z.array(z.string()),
  excluded: z.array(ExcludedFile),
  truncated: z.boolean(),
});
export type InspectionResult = z.infer<typeof InspectionResult>;

/** What will be sent to the model, shown to the user before any model call. */
export const Disclosure = z.object({
  snapshotId: z.string(),
  /** "followup" lists only the NEW excerpts a later round wants to send; consent is required again. */
  scope: z.enum(["initial", "followup"]).default("initial"),
  providerKind: z.enum(["anthropic", "fixture"]),
  providerLabel: z.string(),
  leavesMachine: z.boolean(),
  ticketChars: z.number().int(),
  sentPaths: z.array(z.string()),
  items: z.array(
    z.object({
      evidenceId: z.string(),
      path: z.string(),
      startLine: z.number().int(),
      endLine: z.number().int(),
      chars: z.number().int(),
      estTokens: z.number().int(),
      injectionFlags: z.array(z.string()),
    }),
  ),
  totalChars: z.number().int(),
  estTokens: z.number().int(),
});
export type Disclosure = z.infer<typeof Disclosure>;

/* ------------------------- analysis and questions ------------------------- */

export const Observation = z.object({
  id: z.string().min(1),
  kind: z.literal("observed").default("observed"),
  statement: z.string().min(1),
  evidenceIds: z.array(z.string()),
});
export type Observation = z.infer<typeof Observation>;

export const BehaviorAnalysis = z.object({
  observations: z.array(Observation),
  contradictions: z.array(
    z.object({ id: z.string(), description: z.string(), evidenceIds: z.array(z.string()) }),
  ),
  missingDecisions: z.array(
    z.object({ id: z.string(), topic: z.string(), description: z.string(), evidenceIds: z.array(z.string()) }),
  ),
  /** Things the agent could not establish from the evidence. */
  insufficientEvidence: z.array(z.string()),
  /** evidenceId -> one-sentence explanation of relevance. */
  evidenceNotes: z.record(z.string(), z.string()).default({}),
});
export type BehaviorAnalysis = z.infer<typeof BehaviorAnalysis>;

export const SuggestedAnswer = z.object({
  text: z.string().min(1),
  tradeoff: z.string().default(""),
});

export const Question = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  whyItMatters: z.string().min(1),
  impact: z.enum(["behavior", "scope", "testing"]),
  /** 1 = most important. */
  priority: z.number().int().min(1).max(MAX_QUESTIONS_PER_ROUND),
  suggestedAnswers: z.array(SuggestedAnswer).max(4),
  evidenceIds: z.array(z.string()),
});
export type Question = z.infer<typeof Question>;

export const ClarificationOutput = z.object({
  questions: z.array(Question).max(MAX_QUESTIONS_PER_ROUND),
  /** Why no (more) questions are needed, when the list is empty. */
  note: z.string().default(""),
});
export type ClarificationOutput = z.infer<typeof ClarificationOutput>;

export const ClarificationRound = z.object({
  round: z.number().int().min(1).max(MAX_ROUNDS),
  questions: z.array(Question).max(MAX_QUESTIONS_PER_ROUND),
  note: z.string().default(""),
});
export type ClarificationRound = z.infer<typeof ClarificationRound>;

export const Decision = z.object({
  questionId: z.string(),
  question: z.string(),
  round: z.number().int(),
  /** Empty when deferred. */
  answer: z.string(),
  source: z.enum(["user", "suggestion_accepted", "deferred"]),
  answeredAt: z.string(),
});
export type Decision = z.infer<typeof Decision>;

export const AnswerInput = z.object({
  questionId: z.string(),
  answer: z.string().max(4000).default(""),
  source: z.enum(["user", "suggestion_accepted", "deferred"]),
});
export type AnswerInput = z.infer<typeof AnswerInput>;
export const AnswersBody = z.object({ answers: z.array(AnswerInput).min(1).max(MAX_QUESTIONS_PER_ROUND) });

/* ------------------------------- brief ------------------------------- */

export const AcceptanceCriterion = z.object({
  id: z.string().min(1),
  kind: z.literal("proposed").default("proposed"),
  text: z.string().min(1),
  evidenceIds: z.array(z.string()),
  componentIds: z.array(z.string()),
  testIds: z.array(z.string()),
  /** Question ids whose recorded decision this criterion depends on. */
  decisionRefs: z.array(z.string()).default([]),
  /** Open-question ids this criterion cannot be finalised without. */
  dependsOnOpen: z.array(z.string()).default([]),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterion>;

export const BriefComponent = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  role: z.string(),
  change: z.enum(["modify", "add", "none"]),
  evidenceIds: z.array(z.string()),
});
export type BriefComponent = z.infer<typeof BriefComponent>;

export const BriefStep = z.object({
  id: z.string().min(1),
  kind: z.literal("proposed").default("proposed"),
  text: z.string().min(1),
  componentIds: z.array(z.string()),
  criterionIds: z.array(z.string()),
});
export type BriefStep = z.infer<typeof BriefStep>;

export const BriefTest = z.object({
  id: z.string().min(1),
  kind: z.literal("proposed").default("proposed"),
  description: z.string().min(1),
  level: z.enum(["unit", "integration", "e2e", "manual"]),
  testPath: z.string().nullable().default(null),
  criterionIds: z.array(z.string()),
});
export type BriefTest = z.infer<typeof BriefTest>;

export const BriefRisk = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  evidenceIds: z.array(z.string()).default([]),
});
export type BriefRisk = z.infer<typeof BriefRisk>;

export const BriefAssumption = z.object({
  id: z.string().min(1),
  kind: z.literal("assumed").default("assumed"),
  text: z.string().min(1),
  replaceWhen: z.string().default(""),
});
export type BriefAssumption = z.infer<typeof BriefAssumption>;

export const OpenQuestion = z.object({
  id: z.string().min(1),
  kind: z.literal("unresolved").default("unresolved"),
  text: z.string().min(1),
  questionId: z.string().nullable().default(null),
});
export type OpenQuestion = z.infer<typeof OpenQuestion>;

export const BriefDecision = z.object({
  questionId: z.string(),
  question: z.string(),
  answer: z.string(),
  source: z.enum(["user", "suggestion_accepted"]),
});
export type BriefDecision = z.infer<typeof BriefDecision>;

/** What the brief-generation stage produces; status/approval are added by the application. */
export const BriefContent = z.object({
  title: z.string().min(1),
  requestedOutcome: z.string().min(1),
  scope: z.object({ inScope: z.array(z.string()), outOfScope: z.array(z.string()) }),
  existingBehavior: z.array(Observation),
  decisions: z.array(BriefDecision),
  openQuestions: z.array(OpenQuestion),
  acceptanceCriteria: z.array(AcceptanceCriterion),
  components: z.array(BriefComponent),
  steps: z.array(BriefStep),
  tests: z.array(BriefTest),
  risks: z.array(BriefRisk),
  assumptions: z.array(BriefAssumption),
});
export type BriefContent = z.infer<typeof BriefContent>;

export const Approval = z.object({
  approvedAt: z.string(),
  reviewer: z.string().min(1),
  note: z.string().default(""),
});

export const Brief = BriefContent.extend({
  status: z.enum(["draft", "approved"]),
  approval: Approval.nullable().default(null),
  /** Increments on every save; verification reports pin to a revision. */
  revision: z.number().int().min(1),
  /** How the brief was produced; carried into exports so fixture output can't pass as a model result. */
  producedBy: z.object({ kind: z.enum(["anthropic", "fixture"]), label: z.string() }),
});
export type Brief = z.infer<typeof Brief>;

/* ---------------------------- verification ---------------------------- */

export const SupportVerdict = z.enum(["supported", "weak", "unsupported", "no_evidence"]);
export type SupportVerdict = z.infer<typeof SupportVerdict>;

export const VerificationIssue = z.object({
  severity: z.enum(["error", "warning"]),
  code: z.string(),
  message: z.string(),
  itemId: z.string().nullable(),
});
export type VerificationIssue = z.infer<typeof VerificationIssue>;

export const SupportResult = z.object({
  itemId: z.string(),
  itemType: z.enum(["observation", "criterion", "component", "risk"]),
  verdict: SupportVerdict,
  method: z.enum(["lexical", "model"]),
  detail: z.string(),
});
export type SupportResult = z.infer<typeof SupportResult>;

export const VerificationReport = z.object({
  snapshotId: z.string(),
  briefRevision: z.number().int(),
  generatedAt: z.string(),
  citations: z.object({
    checked: z.number().int(),
    valid: z.number().int(),
    invalid: z.array(z.object({ evidenceId: z.string(), reason: z.string() })),
  }),
  support: z.array(SupportResult),
  issues: z.array(VerificationIssue),
  coverage: z.object({
    criteria: z.number().int(),
    criteriaWithTest: z.number().int(),
    steps: z.number().int(),
    stepsLinked: z.number().int(),
  }),
  passed: z.boolean(),
});
export type VerificationReport = z.infer<typeof VerificationReport>;

/** Output of the optional model-based support judge (supplementary to the lexical check). */
export const SupportJudgeOutput = z.object({
  judgements: z.array(
    z.object({
      itemId: z.string(),
      verdict: z.enum(["supported", "weak", "unsupported"]),
      reason: z.string(),
    }),
  ),
});
export type SupportJudgeOutput = z.infer<typeof SupportJudgeOutput>;

/* ------------------------------ session ------------------------------ */

export const SessionStatus = z.enum([
  "created",
  "inspecting",
  "awaiting_consent",
  "analyzing",
  "awaiting_answers",
  "briefing",
  "review",
  "approved",
  "failed",
  "cancelled",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const ProviderInfo = z.object({
  kind: z.enum(["anthropic", "fixture"]),
  label: z.string(),
  model: z.string().nullable(),
});
export type ProviderInfo = z.infer<typeof ProviderInfo>;

export const SessionError = z.object({
  stage: z.string(),
  message: z.string(),
  recoverable: z.boolean(),
});
export type SessionError = z.infer<typeof SessionError>;

export const Usage = z.object({
  calls: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number().nullable(),
  estimated: z.boolean(),
});
export type Usage = z.infer<typeof Usage>;

export const SessionSummary = z.object({
  id: z.string(),
  title: z.string(),
  repoLabel: z.string(),
  ticket: z.string(),
  provider: ProviderInfo,
  status: SessionStatus,
  round: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  isDemo: z.boolean(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const ActivityEntry = z.object({
  id: z.number().int(),
  at: z.string(),
  stage: z.string(),
  level: z.enum(["info", "warn", "error"]),
  message: z.string(),
});
export type ActivityEntry = z.infer<typeof ActivityEntry>;

export const SessionLimits = z.object({
  maxCalls: z.number(),
  maxInputTokens: z.number(),
  maxOutputTokens: z.number(),
  maxCostUsd: z.number().nullable(),
});
export type SessionLimits = z.infer<typeof SessionLimits>;

export const SessionDetail = z.object({
  session: SessionSummary,
  error: SessionError.nullable(),
  running: z.boolean(),
  inspection: InspectionResult.nullable(),
  evidence: z.array(EvidenceItem),
  /** Follow-up excerpts awaiting consent; shown to the user but NOT yet part of the evidence set or any prompt. */
  pendingEvidence: z.array(EvidenceItem).default([]),
  disclosure: Disclosure.nullable(),
  analysis: BehaviorAnalysis.nullable(),
  rounds: z.array(ClarificationRound),
  decisions: z.array(Decision),
  brief: Brief.nullable(),
  verification: VerificationReport.nullable(),
  activity: z.array(ActivityEntry),
  usage: Usage,
  limits: SessionLimits,
});
export type SessionDetail = z.infer<typeof SessionDetail>;

/* ------------------------------ API bodies ------------------------------ */

export const CreateSessionBody = z.object({
  repoPath: z.string().min(1).max(1000),
  ticket: z.string().min(10, "Ticket is too short to analyze").max(8000),
});
export const ApproveBody = z.object({
  reviewer: z.string().min(1).max(120),
  note: z.string().max(2000).default(""),
  acknowledgeOpenItems: z.boolean().default(false),
});
export const EditBriefBody = z.object({
  brief: BriefContent,
  baseRevision: z.number().int(),
});

/* ------------------- single-prompt baseline (evaluation only) ------------------- */

export const SinglePromptOutput = z.object({
  observations: z.array(
    z.object({
      id: z.string(),
      statement: z.string(),
      citations: z.array(z.object({ path: z.string(), startLine: z.number().int(), endLine: z.number().int() })),
    }),
  ),
  questions: z.array(Question).max(MAX_QUESTIONS_PER_ROUND),
  assumptions: z.array(z.object({ id: z.string(), text: z.string() })),
  acceptanceCriteria: z.array(z.object({ id: z.string(), text: z.string() })),
  filesToChange: z.array(z.string()),
});
export type SinglePromptOutput = z.infer<typeof SinglePromptOutput>;
