import type { EvidenceItem } from "@/shared/schemas";

/** Find an evidence id by path suffix and (optionally) enclosing symbol / text the excerpt must contain. */
export function findEvidence(
  evidence: EvidenceItem[],
  q: { pathEndsWith: string; symbol?: string; contains?: string },
): EvidenceItem | undefined {
  return evidence.find(
    (e) =>
      e.path.endsWith(q.pathEndsWith) &&
      (q.symbol === undefined || e.symbol === q.symbol) &&
      (q.contains === undefined || e.excerpt.includes(q.contains)),
  );
}

export const ids = (...items: (EvidenceItem | undefined)[]): string[] => items.filter((e): e is EvidenceItem => !!e).map((e) => e.id);
