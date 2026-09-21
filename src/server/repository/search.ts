import { buildEvidence, type NewEvidence } from "./evidence";
import { extractSymbols, type CodeSymbol } from "./symbols";
import type { EvidenceItem } from "@/shared/schemas";
import type { Snapshot } from "./types";

/* ------------------------------ tokenizing ------------------------------ */

const STOPWORDS = new Set(
  ("the a an to of in on for and or is are be been being when while we they that this these those with from should can could will would let lets " +
    "allow allows want wants need needs make makes add adds new please so it its as at by if not do does did has have had into than then also any all " +
    "our their there here what which who how why get gets set sets use uses using via per each every some more most other such only just very " +
    "ticket feature support ability able").split(/\s+/),
);

export function tokenize(text: string): string[] {
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return spaced.toLowerCase().match(/[a-z][a-z0-9]+/g) ?? [];
}

/** Deliberately light stemmer: enough to conflate plurals and -ing/-ed without a dependency. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("sses")) return w.slice(0, -2);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) w = w.slice(0, -1);
  return w;
}

const terms = (text: string): string[] => tokenize(text).filter((t) => !STOPWORDS.has(t)).map(stem);

/**
 * Small, domain-agnostic synonym table for common ticket verbs/nouns. Expansion terms are
 * weighted below literal terms. Kept tiny on purpose; evaluations decide whether it grows.
 */
const SYNONYMS: Record<string, string[]> = {
  pause: ["suspend", "mute", "snooze", "disable", "skip", "quiet", "hold"],
  away: ["vacation", "absence", "holiday", "leave", "quiet"],
  notification: ["notify", "alert", "message"],
  delete: ["remove", "destroy", "purge"],
  remove: ["delete"],
  export: ["download", "csv"],
  email: ["mail"],
  refund: ["reimburse", "return", "credit"],
  discount: ["coupon", "promo", "voucher", "price"],
  schedule: ["cron", "timer", "recurring", "interval"],
  permission: ["role", "access", "authorize", "acl"],
  login: ["auth", "session", "signin", "token"],
  remind: ["reminder", "due", "deadline"],
  assign: ["owner", "assignee"],
  limit: ["quota", "cap", "max", "throttle"],
  cancel: ["void", "abort"],
  archive: ["hide", "soft", "delete"],
  stock: ["inventory", "quantity", "reserve"],
};

export interface QueryTerm {
  term: string;
  weight: number;
  origin: "ticket" | "synonym";
}

export function buildQuery(ticket: string): QueryTerm[] {
  const out = new Map<string, QueryTerm>();
  for (const t of terms(ticket)) out.set(t, { term: t, weight: 1, origin: "ticket" });
  for (const base of [...out.keys()]) {
    for (const syn of SYNONYMS[base] ?? []) {
      const s = stem(syn);
      if (!out.has(s)) out.set(s, { term: s, weight: 0.4, origin: "synonym" });
    }
  }
  return [...out.values()];
}

/* ------------------------------- indexing ------------------------------- */

interface Chunk {
  path: string;
  startLine: number;
  endLine: number;
  symbol: CodeSymbol | null;
  text: string;
  tf: Map<string, number>;
  len: number;
}

export interface SearchIndex {
  snapshotId: string;
  chunks: Chunk[];
  df: Map<string, number>;
  avgLen: number;
}

const MAX_CHUNK_LINES = 70;
const WINDOW = 50;
const SMALL_FILE_LINES = 25;

function pushWindows(out: Omit<Chunk, "tf" | "len">[], path: string, lines: string[], start: number, end: number, symbol: CodeSymbol | null) {
  for (let s = start; s <= end; s += WINDOW - 10) {
    const e = Math.min(end, s + WINDOW - 1);
    out.push({ path, startLine: s, endLine: e, symbol, text: lines.slice(s - 1, e).join("\n") });
    if (e >= end) break;
  }
}

const IMPORT_ONLY = /^\s*(import\b|export\s.*\sfrom\b|\/\/)/;

function chunkFile(path: string, content: string, symbols: CodeSymbol[]): Omit<Chunk, "tf" | "len">[] {
  const lines = content.split("\n");
  const total = lines.length;
  const out: Omit<Chunk, "tf" | "len">[] = [];
  if (total <= SMALL_FILE_LINES) {
    return [{ path, startLine: 1, endLine: total, symbol: symbols[0] ?? null, text: content }];
  }
  // Leaf symbols: markdown sections nest, code declarations are top-level by construction.
  let cursor = 1;
  const sorted = [...symbols].sort((a, b) => a.startLine - b.startLine);
  for (const sym of sorted) {
    if (sym.startLine < cursor) continue;
    if (sym.kind === "const" && sym.endLine - sym.startLine < 2) continue; // tiny constants stay in surrounding gap text
    if (sym.startLine > cursor) {
      const gapLines = lines.slice(cursor - 1, sym.startLine - 1).filter((l) => l.trim() !== "" && !IMPORT_ONLY.test(l));
      if (gapLines.length >= 3) pushWindows(out, path, lines, cursor, sym.startLine - 1, null);
    }
    if (sym.endLine - sym.startLine + 1 > MAX_CHUNK_LINES) pushWindows(out, path, lines, sym.startLine, sym.endLine, sym);
    else out.push({ path, startLine: sym.startLine, endLine: sym.endLine, symbol: sym, text: lines.slice(sym.startLine - 1, sym.endLine).join("\n") });
    cursor = sym.endLine + 1;
  }
  if (cursor <= total) {
    const rest = lines.slice(cursor - 1).filter((l) => l.trim() !== "" && !IMPORT_ONLY.test(l)).length;
    if (rest >= 3 || out.length === 0) pushWindows(out, path, lines, cursor, total, null);
  }
  return out;
}

const indexCache = new Map<string, SearchIndex>();

export function buildIndex(snapshot: Snapshot): SearchIndex {
  const cached = indexCache.get(snapshot.id);
  if (cached) return cached;
  const chunks: Chunk[] = [];
  for (const file of snapshot.files.values()) {
    if (file.language === "JSON" && file.path.endsWith("package-lock.json")) continue;
    const symbols = extractSymbols(file);
    for (const c of chunkFile(file.path, file.content, symbols)) {
      const tf = new Map<string, number>();
      const bump = (t: string, n: number) => tf.set(t, (tf.get(t) ?? 0) + n);
      const bodyTokens = terms(c.text);
      for (const t of bodyTokens) bump(t, 1);
      for (const t of terms(c.symbol?.name ?? "")) bump(t, 3);
      for (const t of terms(c.path)) bump(t, 2);
      chunks.push({ ...c, tf, len: Math.max(1, bodyTokens.length) });
    }
  }
  const df = new Map<string, number>();
  for (const c of chunks) for (const t of c.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avgLen = chunks.reduce((s, c) => s + c.len, 0) / Math.max(1, chunks.length);
  const index = { snapshotId: snapshot.id, chunks, df, avgLen };
  indexCache.set(snapshot.id, index);
  if (indexCache.size > 12) indexCache.delete(indexCache.keys().next().value as string);
  return index;
}

/* -------------------------------- scoring -------------------------------- */

const K1 = 1.2;
const B = 0.4;

interface Scored {
  chunk: Chunk;
  score: number;
  matched: string[];
  reason: string;
}

export function scoreChunks(index: SearchIndex, query: QueryTerm[]): Scored[] {
  const N = index.chunks.length;
  const totalWeight = query.filter((q) => q.origin === "ticket").reduce((s, q) => s + q.weight, 0) || 1;
  const out: Scored[] = [];
  for (const chunk of index.chunks) {
    let score = 0;
    let literalWeight = 0;
    const matched: string[] = [];
    for (const q of query) {
      const tf = chunk.tf.get(q.term) ?? 0;
      if (tf === 0) continue;
      const n = index.df.get(q.term) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += q.weight * idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * chunk.len) / index.avgLen)));
      matched.push(q.term);
      if (q.origin === "ticket") literalWeight += q.weight;
    }
    if (score <= 0) continue;
    score *= 1 + 0.6 * (literalWeight / totalWeight);
    out.push({
      chunk,
      score,
      matched,
      reason: `lexical match on ${matched.slice(0, 6).join(", ")}${chunk.symbol ? `; in ${chunk.symbol.kind} ${chunk.symbol.name}` : ""}`,
    });
  }
  return out.sort((a, b) => b.score - a.score || (a.chunk.path < b.chunk.path ? -1 : 1) || a.chunk.startLine - b.chunk.startLine);
}

/* -------------------------------- retrieval -------------------------------- */

export interface RetrievalOptions {
  maxItems: number;
  maxChars: number;
  maxPerFile: number;
  /** Multiplier for README/changelog-style files, which match generic ticket words without describing behavior. */
  boilerplateWeight: number;
  /** Keep hits scoring at least this fraction of the best hit. */
  relativeCutoff: number;
  /** Always keep at least this many top-scoring chunks, even below the cutoff (recall over precision at this stage). */
  minItems: number;
  maxReferenceHops: number;
}

export const DEFAULT_RETRIEVAL: RetrievalOptions = {
  maxItems: 18,
  maxChars: 24_000,
  maxPerFile: 3,
  boilerplateWeight: 0.5,
  relativeCutoff: 0.22,
  minItems: 6,
  maxReferenceHops: 6,
};

const overlaps = (a: { path: string; startLine: number; endLine: number }, b: { path: string; startLine: number; endLine: number }) =>
  a.path === b.path && a.startLine <= b.endLine && b.startLine <= a.endLine;

const BOILERPLATE = /(^|\/)(readme|changelog|contributing|license|code_of_conduct)(\.[a-z]+)?$/i;
export const isBoilerplate = (p: string): boolean => BOILERPLATE.test(p);

export interface RetrievalResult {
  query: QueryTerm[];
  evidence: EvidenceItem[];
  totalChars: number;
}

/** Stage 2: deterministic lexical + symbol-aware retrieval of bounded excerpts. */
export function retrieveEvidence(snapshot: Snapshot, ticket: string, options: Partial<RetrievalOptions> = {}): RetrievalResult {
  const opt = { ...DEFAULT_RETRIEVAL, ...options };
  const index = buildIndex(snapshot);
  const query = buildQuery(ticket);
  const scored = scoreChunks(index, query)
    .map((x) => (isBoilerplate(x.chunk.path) ? { ...x, score: x.score * opt.boilerplateWeight } : x))
    .sort((a, b) => b.score - a.score);
  const top = scored[0]?.score ?? 0;

  const picked: (NewEvidence & { chars: number })[] = [];
  let chars = 0;
  const perFile = new Map<string, number>();

  const tryAdd = (s: Scored, scoreOverride?: number, reasonOverride?: string): boolean => {
    if (picked.length >= opt.maxItems) return false;
    const c = s.chunk;
    const size = c.text.length;
    if (chars + size > opt.maxChars) return false;
    if ((perFile.get(c.path) ?? 0) >= opt.maxPerFile) return false;
    if (picked.some((p) => overlaps(p, c))) return false;
    picked.push({
      path: c.path,
      startLine: c.startLine,
      endLine: c.endLine,
      symbol: c.symbol?.name ?? null,
      score: scoreOverride ?? s.score,
      matchedTerms: s.matched,
      retrievalReason: reasonOverride ?? s.reason,
      chars: size,
    });
    chars += size;
    perFile.set(c.path, (perFile.get(c.path) ?? 0) + 1);
    return true;
  };

  for (const s of scored) {
    if (s.score < top * opt.relativeCutoff && picked.length >= opt.minItems) break;
    tryAdd(s);
  }

  // Symbol-aware second hop: pull in chunks elsewhere that reference identifiers defined by the best hits.
  const definers = picked
    .slice(0, 6)
    .filter((p) => p.symbol && /^[A-Za-z_$][\w$]{4,}$/.test(p.symbol))
    .map((p) => ({ name: p.symbol as string, path: p.path, score: p.score }));
  let hops = 0;
  for (const d of definers) {
    const re = new RegExp(`\\b${d.name.replace(/[$]/g, "\\$")}\\b`);
    for (const c of index.chunks) {
      if (hops >= opt.maxReferenceHops) break;
      if (c.path === d.path || !re.test(c.text)) continue;
      const already = picked.some((p) => overlaps(p, c));
      if (already) continue;
      if (tryAdd({ chunk: c, score: d.score * 0.4, matched: [d.name], reason: "" }, d.score * 0.4, `references ${d.name} (defined in ${d.path})`)) hops++;
    }
  }

  // Forward hop: definitions of identifiers that the best hits call or use.
  const defs = new Map<string, Chunk[]>();
  for (const c of index.chunks) {
    if (c.symbol && c.symbol.kind !== "heading" && c.symbol.name.length >= 5) {
      defs.set(c.symbol.name, [...(defs.get(c.symbol.name) ?? []), c]);
    }
  }
  let forward = 0;
  for (const p of picked.slice(0, 10)) {
    const src = index.chunks.find((c) => c.path === p.path && c.startLine === p.startLine);
    if (!src) continue;
    const seen = new Set<string>();
    for (const id of src.text.match(/\b[A-Za-z_$][\w$]{4,}\b/g) ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const candidates = defs.get(id);
      if (!candidates || candidates.length !== 1) continue;
      const def = candidates[0] as Chunk;
      if (def.path === p.path || forward >= opt.maxReferenceHops) continue;
      if (tryAdd({ chunk: def, score: p.score * 0.35, matched: [id], reason: "" }, p.score * 0.35, `defines ${id}, used by ${p.path}`)) forward++;
    }
  }

  picked.sort((a, b) => b.score - a.score);
  const evidence = picked.map((p) => buildEvidence(snapshot, p));
  return { query, evidence, totalChars: evidence.reduce((s, e) => s + e.excerpt.length, 0) };
}
