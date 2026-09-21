import type { Disclosure, EvidenceItem, InspectionResult } from "@/shared/schemas";
import { inspectSnapshot } from "@/server/repository/inspect";
import { queryTerms, retrieveEvidence, type RetrievalResult } from "@/server/repository/search";
import type { Snapshot } from "@/server/repository/types";
import { estimateTokens, type LlmProvider } from "@/server/llm/provider";
import { SYSTEM_PROMPT } from "@/server/llm/prompts";

export interface Investigation {
  inspection: InspectionResult;
  retrieval: RetrievalResult;
  evidence: EvidenceItem[];
}

/** Stages 1 and 2: pure functions of the snapshot and ticket. No model, no network. */
export function investigate(snapshot: Snapshot, ticket: string): Investigation {
  const inspection = inspectSnapshot(snapshot);
  const retrieval = retrieveEvidence(snapshot, ticket);
  return { inspection, retrieval, evidence: retrieval.evidence };
}

/** Exactly what the model stages will receive, shown to the user before they consent. */
export function buildDisclosure(snapshot: Snapshot, evidence: EvidenceItem[], ticket: string, provider: LlmProvider, scope: Disclosure["scope"] = "initial"): Disclosure {
  const items = evidence.map((e) => ({
    evidenceId: e.id,
    path: e.path,
    startLine: e.startLine,
    endLine: e.endLine,
    chars: e.excerpt.length,
    estTokens: estimateTokens(e.excerpt),
    injectionFlags: e.injectionFlags,
  }));
  const totalChars = items.reduce((s, i) => s + i.chars, 0);
  return {
    scope,
    snapshotId: snapshot.id,
    providerKind: provider.info.kind,
    providerLabel: provider.info.label,
    leavesMachine: provider.leavesMachine,
    ticketChars: ticket.length,
    sentPaths: [...new Set(evidence.map((e) => e.path))].sort(),
    items,
    totalChars,
    estTokens: estimateTokens(SYSTEM_PROMPT) + estimateTokens(ticket) + items.reduce((s, i) => s + i.estTokens, 0),
  };
}

export const MAX_NEW_FOLLOWUP_EXCERPTS = 6;
export const MAX_TOTAL_EXCERPTS = 30;

/**
 * Excerpts a follow-up round would add: retrieval over the ticket plus the human's answers,
 * minus everything already known. Deterministic; nothing is sent anywhere by calling this.
 */
export function findNewEvidence(snapshot: Snapshot, ticket: string, answersText: string, existing: EvidenceItem[]): EvidenceItem[] {
  const room = Math.max(0, MAX_TOTAL_EXCERPTS - existing.length);
  if (room === 0 || answersText.trim() === "") return [];
  const known = new Set(existing.map((e) => e.id));
  const covered = (e: EvidenceItem) => existing.some((x) => x.path === e.path && x.startLine <= e.endLine && e.startLine <= x.endLine);
  // Only propose excerpts matching at least two words the human introduced (not already in the ticket):
  // loosely related chunks should not force a consent step after every round.
  const ticketTerms = new Set(queryTerms(ticket));
  const answerOnly = new Set(queryTerms(answersText).filter((t) => !ticketTerms.has(t)));
  const introduced = (e: EvidenceItem) => !/^(references|defines) /.test(e.retrievalReason) && e.matchedTerms.filter((t) => answerOnly.has(t)).length >= 2;
  return retrieveEvidence(snapshot, `${ticket}\n${answersText}`)
    .evidence.filter((e) => !known.has(e.id) && !covered(e) && introduced(e))
    .slice(0, Math.min(room, MAX_NEW_FOLLOWUP_EXCERPTS));
}
