import { describe, expect, it } from "vitest";
import { verifyEvidenceRef, buildEvidence, evidenceId } from "@/server/repository/evidence";
import { buildQuery, candidateTestPaths, retrieveEvidence, stem, tokenize } from "@/server/repository/search";
import { createSnapshot } from "@/server/repository/snapshot";
import { extractSymbols } from "@/server/repository/symbols";
import type { Snapshot, SnapshotFile } from "@/server/repository/types";
import { DEMO_REPO, DEMO_TICKET } from "./helpers";

const file = (path: string, language: string, content: string): SnapshotFile => ({ path, language, content, size: content.length, sha256: "x" });

let snapshotCounter = 0;
const snapshotOf = (files: SnapshotFile[]): Snapshot => ({
  // buildIndex() caches by id (search.ts), so distinct synthetic snapshots need distinct ids or
  // they'd collide and one test's index would leak into another's.
  id: `test-snapshot-${++snapshotCounter}`,
  root: "/test",
  commit: null,
  files: new Map(files.map((f) => [f.path, f])),
  excluded: [],
  truncated: false,
  capturedAt: new Date(0).toISOString(),
});

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

describe("candidateTestPaths", () => {
  it("derives the TS/JS and Python conventional test paths from a source file's basename", () => {
    expect(candidateTestPaths("src/notifications/dispatcher.ts")).toEqual(["tests/dispatcher.test.ts", "tests/test_dispatcher.py"]);
  });

  it("works for a bare filename with no directory", () => {
    expect(candidateTestPaths("dispatcher.ts")).toEqual(["tests/dispatcher.test.ts", "tests/test_dispatcher.py"]);
  });

  it("strips only the last extension, keeping dots inside the stem", () => {
    expect(candidateTestPaths("src/a.b.c.ts")).toEqual(["tests/a.b.c.test.ts", "tests/test_a.b.c.py"]);
  });

  it("falls back to the whole filename when there is no extension", () => {
    expect(candidateTestPaths("src/Makefile")).toEqual(["tests/Makefile.test.ts", "tests/test_Makefile.py"]);
  });
});

describe("test-file pairing", () => {
  // Six high-scoring padding files rank above the target file, so it lands outside picked.slice(0,
  // 6) and is never treated as a "definer" by the ordinary symbol-aware second hop -- the only way
  // its test file can be reached is the pairing pass, which (unlike that hop) looks at every picked
  // source file, not just the top few. The test file shares no vocabulary with the ticket or with
  // target.ts's identifier, so it can't be picked up lexically either.
  const padding = Array.from({ length: 6 }, (_, i) => file(`src/padding${i}.ts`, "TypeScript", "widget ".repeat(60)));
  const target = file("src/target.ts", "TypeScript", "// Handles a widget.\nexport function handleWidgetRequest(id: string): void {\n  return;\n}\n");
  const targetTest = file("tests/target.test.ts", "TypeScript", "// Regression coverage for a change made earlier this cycle.\nimport thing from \"../src/target\";\nthing();\n");
  const snap = snapshotOf([...padding, target, targetTest]);

  it("pairs a retrieved source file with its own test file even when it's not a top-6 definer", () => {
    const result = retrieveEvidence(snap, "widget", { minItems: 7, relativeCutoff: 0.99 });
    expect(result.evidence.map((e) => e.path)).toContain("src/target.ts");
    const paired = result.evidence.find((e) => e.path === "tests/target.test.ts");
    expect(paired).toBeDefined();
    expect(paired!.retrievalReason).toBe("tests src/target.ts, which was retrieved");
  });

  it("stops pairing test files when maxTestPairs is 0", () => {
    const result = retrieveEvidence(snap, "widget", { minItems: 7, relativeCutoff: 0.99, maxTestPairs: 0 });
    expect(result.evidence.some((e) => e.path === "tests/target.test.ts")).toBe(false);
  });
});

describe("per-definer cap on the symbol-aware second hop", () => {
  const definer = file(
    "src/core.ts",
    "TypeScript",
    ["export function processWidget(widgetId: string): void {", "  // widget widget widget widget widget widget widget widget", "  const widget = widgetId;", "  void widget;", "}"].join("\n"),
  );
  const callers = Array.from({ length: 6 }, (_, i) =>
    file(`src/callers/caller${i}.ts`, "TypeScript", `import { processWidget } from "../core";\nprocessWidget("caller-${i}");\n`),
  );
  const snap = snapshotOf([definer, ...callers]);
  const ticket = "How does the system process a widget?";

  // relativeCutoff/minItems pinned tight so only the (heavily widget-repeating) definer clears the
  // initial lexical pass; every caller is reachable only through the second hop below.
  const hopReasonsFor = (maxHopsPerDefiner: number, maxReferenceHops: number) =>
    retrieveEvidence(snap, ticket, { relativeCutoff: 0.99, minItems: 1, maxTestPairs: 0, maxHopsPerDefiner, maxReferenceHops }).evidence.filter((e) =>
      e.retrievalReason.startsWith("references processWidget"),
    );

  it("caps hops contributed by a single definer even when the shared budget has room", () => {
    expect(hopReasonsFor(2, 100)).toHaveLength(2);
  });

  it("lets a single definer fill the shared budget when its own cap is generous", () => {
    expect(hopReasonsFor(10, 10)).toHaveLength(6);
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
