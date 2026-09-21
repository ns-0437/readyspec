import { describe, expect, it } from "vitest";
import { verifyEvidenceRef, buildEvidence, evidenceId } from "@/server/repository/evidence";
import { buildQuery, retrieveEvidence, stem, tokenize } from "@/server/repository/search";
import { createSnapshot } from "@/server/repository/snapshot";
import { extractSymbols } from "@/server/repository/symbols";
import type { SnapshotFile } from "@/server/repository/types";
import { DEMO_REPO, DEMO_TICKET } from "./helpers";

const file = (path: string, language: string, content: string): SnapshotFile => ({ path, language, content, size: content.length, sha256: "x" });

describe("tokenizing and query building", () => {
  it("splits camelCase, snake_case and paths", () => {
    expect(tokenize("dispatchNotification")).toEqual(["dispatch", "notification"]);
    expect(tokenize("category_disabled")).toEqual(["category", "disabled"]);
    expect(tokenize("src/users/preferences.ts")).toEqual(["src", "users", "preferences", "ts"]);
  });

  it("stems plurals and suffixes lightly", () => {
    expect(stem("notifications")).toBe("notification");
    expect(stem("policies")).toBe("policy");
    expect(stem("pausing")).toBe("paus");
    expect(stem("class")).toBe("class");
  });

  it("weights literal ticket terms above synonym expansions", () => {
    const q = buildQuery("Let users pause notifications while they are away.");
    const pause = q.find((t) => t.term === "pause")!;
    const mute = q.find((t) => t.term === "mute")!;
    expect(pause).toMatchObject({ weight: 1, origin: "ticket" });
    expect(mute).toMatchObject({ weight: 0.4, origin: "synonym" });
    expect(q.some((t) => t.term === "let" || t.term === "while")).toBe(false);
  });
});

describe("symbol extraction", () => {
  it("finds TypeScript declarations with correct ranges", () => {
    const src = ["import x from 'y';", "", "export interface A {", "  a: string;", "}", "", "export async function go(n: number) {", "  if (n) {", "    return 1;", "  }", "  return 2;", "}", "", "export const MAX = 3;"].join("\n");
    const syms = extractSymbols(file("a.ts", "TypeScript", src));
    expect(syms.map((s) => [s.name, s.kind, s.startLine, s.endLine])).toEqual([
      ["A", "interface", 3, 5],
      ["go", "function", 7, 12],
      ["MAX", "const", 14, 14],
    ]);
  });

  it("ignores braces inside strings and comments", () => {
    const src = ["export function f() {", '  const s = "}}}";', "  // {{{", "  return s;", "}", "export const z = 1;"].join("\n");
    const syms = extractSymbols(file("a.ts", "TypeScript", src));
    expect(syms.find((s) => s.name === "f")).toMatchObject({ startLine: 1, endLine: 5 });
  });

  it("finds Python defs by indentation and Markdown sections", () => {
    const py = extractSymbols(file("a.py", "Python", "def a():\n    return 1\n\nclass B:\n    def m(self):\n        pass\n"));
    expect(py.map((s) => s.name)).toEqual(["a", "B"]);
    const md = extractSymbols(file("a.md", "Markdown", "# One\ntext\n## Two\nmore\n```\n# not a heading\n```\n"));
    expect(md.map((s) => s.name)).toEqual(["One", "Two"]);
    expect(md[0]!.endLine).toBe(2);
  });
});

describe("retrieval on the demo fixture", () => {
  const snap = createSnapshot(DEMO_REPO);
  const result = retrieveEvidence(snap, DEMO_TICKET);
  const paths = new Set(result.evidence.map((e) => e.path));

  it("finds the code that decides delivery, stores preferences, handles retries and timezones", () => {
    for (const p of ["src/notifications/dispatcher.ts", "src/users/preferences.ts", "src/notifications/retry-queue.ts", "src/notifications/digest.ts", "docs/notifications.md"]) {
      expect(paths, p).toContain(p);
    }
    expect(result.evidence.some((e) => e.symbol === "decideDelivery")).toBe(true);
  });

  it("leaves out unrelated files", () => {
    expect(paths.has("src/billing/invoice.ts")).toBe(false);
    expect(paths.has("src/reports/export.ts")).toBe(false);
  });

  it("respects item and character budgets and per-file caps", () => {
    const small = retrieveEvidence(snap, DEMO_TICKET, { maxItems: 4 });
    expect(small.evidence.length).toBeLessThanOrEqual(4);
    const tiny = retrieveEvidence(snap, DEMO_TICKET, { maxChars: 800 });
    expect(tiny.totalChars).toBeLessThanOrEqual(800);
    const counts = new Map<string, number>();
    for (const e of result.evidence) counts.set(e.path, (counts.get(e.path) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
  });

  it("never returns overlapping ranges in one file", () => {
    for (const a of result.evidence) for (const b of result.evidence) {
      if (a !== b && a.path === b.path) expect(a.startLine <= b.endLine && b.startLine <= a.endLine).toBe(false);
    }
  });

  it("returns nothing for a ticket unrelated to the code (and says so by being empty)", () => {
    const none = retrieveEvidence(snap, "Quantum entanglement telescope calibration");
    expect(none.evidence).toEqual([]);
  });

  it("is deterministic", () => {
    const again = retrieveEvidence(snap, DEMO_TICKET);
    expect(again.evidence.map((e) => e.id)).toEqual(result.evidence.map((e) => e.id));
  });

  it("flags the planted injection text", () => {
    const inj = result.evidence.find((e) => e.path === "docs/AGENT_NOTES.md");
    expect(inj?.injectionFlags.length).toBeGreaterThan(0);
  });
});

describe("boilerplate down-weighting", () => {
  it("ranks README-style files lower when the weight is below 1, and never drops recall of code files", () => {
    const snap = createSnapshot(DEMO_REPO);
    const on = retrieveEvidence(snap, DEMO_TICKET, { boilerplateWeight: 1 });
    const off = retrieveEvidence(snap, DEMO_TICKET, { boilerplateWeight: 0.1 });
    const rank = (r: typeof on) => r.evidence.findIndex((e) => /readme/i.test(e.path));
    if (rank(on) >= 0 && rank(off) >= 0) expect(rank(off)).toBeGreaterThanOrEqual(rank(on));
    expect(new Set(off.evidence.map((e) => e.path))).toContain("src/notifications/dispatcher.ts");
  });
});

describe("evidence validation against the snapshot", () => {
  const snap = createSnapshot(DEMO_REPO);
  const ev = buildEvidence(snap, { path: "src/notifications/dispatcher.ts", startLine: 13, endLine: 17, symbol: "decideDelivery", score: 1, matchedTerms: [], retrievalReason: "test" });

  it("accepts an untouched citation", () => {
    expect(verifyEvidenceRef(snap, ev)).toEqual({ ok: true });
    expect(ev.id).toBe(evidenceId("src/notifications/dispatcher.ts", 13, 17));
  });

  it("rejects unknown paths, bad ranges and changed content", () => {
    expect(verifyEvidenceRef(snap, { ...ev, path: "src/nope.ts" })).toMatchObject({ ok: false, reason: expect.stringContaining("not in snapshot") });
    expect(verifyEvidenceRef(snap, { ...ev, endLine: 9999 })).toMatchObject({ ok: false, reason: expect.stringContaining("past end") });
    expect(verifyEvidenceRef(snap, { ...ev, startLine: 20, endLine: 10 })).toMatchObject({ ok: false });
    expect(verifyEvidenceRef(snap, { ...ev, startLine: 14 })).toMatchObject({ ok: false, reason: "content hash mismatch" });
    expect(verifyEvidenceRef(snap, { ...ev, contentHash: "0".repeat(64) })).toMatchObject({ ok: false, reason: "content hash mismatch" });
  });

  it("refuses to build evidence for a path outside the snapshot", () => {
    expect(() => buildEvidence(snap, { path: "../../etc/passwd", startLine: 1, endLine: 2, symbol: null, score: 1, matchedTerms: [], retrievalReason: "" })).toThrow();
  });
});
