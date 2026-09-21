import type {
  BehaviorAnalysis,
  ClarificationRound,
  Decision,
  EvidenceItem,
  InspectionResult,
  Question,
} from "@/shared/schemas";

/** Typed inputs to each model stage. Prompts are rendered from these; the fixture provider reads them directly. */
export interface AnalyzeContext {
  ticket: string;
  evidence: EvidenceItem[];
  inspection: InspectionResult;
}

export interface ClarifyContext {
  ticket: string;
  analysis: BehaviorAnalysis;
  evidence: EvidenceItem[];
  decisions: Decision[];
  priorQuestions: Question[];
  round: number;
}

export interface BriefContext {
  ticket: string;
  analysis: BehaviorAnalysis;
  evidence: EvidenceItem[];
  decisions: Decision[];
  rounds: ClarificationRound[];
  inspection: InspectionResult;
}

export interface JudgeContext {
  items: { itemId: string; itemType: string; statement: string; evidenceIds: string[] }[];
  evidence: EvidenceItem[];
}

export interface SinglePromptContext {
  ticket: string;
  files: { path: string; content: string; truncated: boolean }[];
}
