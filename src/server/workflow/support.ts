import type { EvidenceItem, SupportVerdict } from "@/shared/schemas";

export interface SupportAssessment {
  verdict: SupportVerdict;
  detail: string;
  checked: string[];
  missing: string[];
}

/**
 * Tokens in a claim that can be checked mechanically against cited code: identifiers with
 * internal case/underscore structure, CONSTANTS, dotted member access, file paths and quoted
 * literals. Plain English words are ignored (they cannot be verified lexically).
 */
export function checkableTokens(statement: string): string[] {
  const out = new Set<string>();
  const add = (t: string) => {
    const cleaned = t.replace(/^[`'".]+|[`'".,;:()]+$/g, "");
    if (cleaned.length >= 3) out.add(cleaned);
  };
  for (const m of statement.matchAll(/\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/g)) add(m[0]); // camelCase
  for (const m of statement.matchAll(/\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b/g)) add(m[0]); // PascalCase
  for (const m of statement.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)) add(m[0]); // snake_case
  for (const m of statement.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) add(m[0]); // CONSTANT
  for (const m of statement.matchAll(/\b[a-zA-Z_$][\w$]*\.[a-zA-Z_$][\w$]*\b/g)) if (!/\.(md|ts|tsx|js|json|py|go)$/i.test(m[0])) add(m[0]); // a.b
  for (const m of statement.matchAll(/[\w./-]+\.(?:ts|tsx|js|jsx|py|go|md|json|ya?ml|env)\b/g)) add(m[0]); // paths
  for (const m of statement.matchAll(/"([^"\n]{2,40})"/g)) if (m[1]) add(m[1]); // "literals"
  for (const m of statement.matchAll(/`([^`\n]{2,60})`/g)) if (m[1]) add(m[1]); // `code`
  return [...out];
}

/**
 * Lexical support check: are the code-like things a claim mentions actually present in the
 * cited excerpts? This catches invented identifiers and mis-cited evidence. It cannot prove a
 * claim's meaning is right, so "supported" means "not contradicted by missing references".
 */
export function assessSupport(statement: string, cited: EvidenceItem[]): SupportAssessment {
  if (cited.length === 0) {
    return { verdict: "no_evidence", detail: "No evidence is cited for this claim.", checked: [], missing: [] };
  }
  const haystack = cited.map((e) => `${e.path}\n${e.excerpt}`).join("\n");
  const tokens = checkableTokens(statement);
  if (tokens.length === 0) {
    return { verdict: "weak", detail: "The claim names no identifiers or literals that can be checked against the cited code.", checked: [], missing: [] };
  }
  // A dotted access such as `categories.security` is satisfied when both parts appear in the cited code.
  const present = (t: string) => haystack.includes(t) || (/^[\w$]+(\.[\w$]+)+$/.test(t) && t.split(".").every((part) => haystack.includes(part)));
  const missing = tokens.filter((t) => !present(t));
  const found = tokens.length - missing.length;
  const ratio = found / tokens.length;
  if (ratio >= 0.8) return { verdict: "supported", detail: `${found}/${tokens.length} referenced identifiers appear in the cited lines.`, checked: tokens, missing };
  if (ratio >= 0.4) return { verdict: "weak", detail: `Only ${found}/${tokens.length} referenced identifiers appear in the cited lines; missing: ${missing.join(", ")}.`, checked: tokens, missing };
  return { verdict: "unsupported", detail: `Most referenced identifiers are absent from the cited lines; missing: ${missing.join(", ")}.`, checked: tokens, missing };
}
