import crypto from "node:crypto";
import type { EvidenceItem, EvidenceRef } from "@/shared/schemas";
import { detectInjection } from "./filters";
import { sha256 } from "./snapshot";
import type { Snapshot } from "./types";

/** Stable across rounds and re-runs: same path + range gives the same id. */
export function evidenceId(filePath: string, startLine: number, endLine: number): string {
  return "ev-" + crypto.createHash("sha1").update(`${filePath}:${startLine}-${endLine}`).digest("hex").slice(0, 8);
}

export function excerptOf(content: string, startLine: number, endLine: number): string {
  return content.split("\n").slice(startLine - 1, endLine).join("\n");
}

export interface NewEvidence {
  path: string;
  startLine: number;
  endLine: number;
  symbol: string | null;
  score: number;
  matchedTerms: string[];
  retrievalReason: string;
}

/** Build an evidence item from a range of a snapshot file. Throws if the range is invalid. */
export function buildEvidence(snapshot: Snapshot, e: NewEvidence): EvidenceItem {
  const file = snapshot.files.get(e.path);
  if (!file) throw new Error(`buildEvidence: ${e.path} is not in snapshot ${snapshot.id}`);
  const total = file.content.split("\n").length;
  const start = Math.max(1, e.startLine);
  const end = Math.min(total, Math.max(start, e.endLine));
  const excerpt = excerptOf(file.content, start, end);
  return {
    id: evidenceId(e.path, start, end),
    path: e.path,
    startLine: start,
    endLine: end,
    contentHash: sha256(excerpt),
    snapshotId: snapshot.id,
    language: file.language,
    excerpt,
    symbol: e.symbol,
    score: Math.round(e.score * 1000) / 1000,
    matchedTerms: e.matchedTerms,
    retrievalReason: e.retrievalReason,
    explanation: "",
    injectionFlags: detectInjection(excerpt),
  };
}

export type EvidenceCheck = { ok: true } | { ok: false; reason: string };

/**
 * Deterministic citation check against the pinned snapshot: the file exists, the line range is
 * inside it, and the cited lines still hash to the recorded value. This proves the citation is
 * *valid*, not that it *supports* any claim — see workflow/verify.ts for support checks.
 */
export function verifyEvidenceRef(snapshot: Snapshot, ref: EvidenceRef): EvidenceCheck {
  const file = snapshot.files.get(ref.path);
  if (!file) return { ok: false, reason: `path not in snapshot: ${ref.path}` };
  const total = file.content.split("\n").length;
  if (ref.startLine < 1 || ref.endLine < ref.startLine) return { ok: false, reason: "invalid line range" };
  if (ref.endLine > total) return { ok: false, reason: `line ${ref.endLine} is past end of file (${total} lines)` };
  if (sha256(excerptOf(file.content, ref.startLine, ref.endLine)) !== ref.contentHash) {
    return { ok: false, reason: "content hash mismatch" };
  }
  return { ok: true };
}
