import type { Disclosure, EvidenceItem, InspectionResult } from "@/shared/schemas";
import { inspectSnapshot } from "@/server/repository/inspect";
import { retrieveEvidence, type RetrievalResult } from "@/server/repository/search";
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
export function buildDisclosure(snapshot: Snapshot, evidence: EvidenceItem[], ticket: string, provider: LlmProvider): Disclosure {
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
