import { beforeAll, describe, expect, it } from "vitest";
import { contentOf, removeItem, removeScopeItem, setItemText, setScopeItem } from "@/shared/brief-edit";
import { traceCriterion } from "@/shared/trace";
import type { Brief, EvidenceItem } from "@/shared/schemas";
import { exportGithubIssue, exportJson, exportMarkdown } from "@/server/workflow/export";
import { makeService, runToReview } from "./helpers";

let brief: Brief;
let evidence: EvidenceItem[];
let detail: Awaited<ReturnType<typeof runToReview>>["detail"];

beforeAll(async () => {
  const { service } = makeService();
  detail = (await runToReview(service)).detail;
  brief = detail.brief!;
  evidence = detail.evidence;
});

describe("brief-edit helpers", () => {
  it("edits text in place without mutating the input", () => {
    const c = contentOf(brief);
    const before = JSON.stringify(c);
    const next = setItemText(c, "acceptanceCriteria", "ac-1", "New text");
    expect(next.acceptanceCriteria[0]!.text).toBe("New text");
    expect(JSON.stringify(c)).toBe(before);
  });

  it("removing a test strips it from criteria so the gap is visible to verification", () => {
    const c = contentOf(brief);
    const t = c.acceptanceCriteria[0]!.testIds[0]!;
    const next = removeItem(c, "tests", t);
    expect(next.tests.some((x) => x.id === t)).toBe(false);
    expect(next.acceptanceCriteria[0]!.testIds).not.toContain(t);
  });

  it("removing a criterion or component or open question cleans references", () => {
    const c = contentOf(brief);
    const noCrit = removeItem(c, "acceptanceCriteria", "ac-1");
    expect(noCrit.tests.every((t) => !t.criterionIds.includes("ac-1"))).toBe(true);
    expect(noCrit.steps.every((s) => !s.criterionIds.includes("ac-1"))).toBe(true);
    const noComp = removeItem(c, "components", c.components[0]!.id);
    expect(noComp.acceptanceCriteria.every((x) => !x.componentIds.includes(c.components[0]!.id))).toBe(true);
    const oq = c.openQuestions[0]!.id;
    const noOq = removeItem(c, "openQuestions", oq);
    expect(noOq.acceptanceCriteria.every((x) => !x.dependsOnOpen.includes(oq))).toBe(true);
  });

  it("edits and removes scope items", () => {
    const c = contentOf(brief);
    expect(setScopeItem(c, "inScope", 0, "X").scope.inScope[0]).toBe("X");
    expect(removeScopeItem(c, "outOfScope", 0).scope.outOfScope).toHaveLength(c.scope.outOfScope.length - 1);
  });

  it("contentOf drops status, approval, revision and provenance", () => {
    const c = contentOf(brief) as Record<string, unknown>;
    for (const k of ["status", "approval", "revision", "producedBy"]) expect(k in c).toBe(false);
  });
});

describe("traceCriterion (the click-a-criterion interaction)", () => {
  it("connects a criterion to its evidence, components, tests, steps and decisions together", () => {
    const c = contentOf(brief);
    const withDecision = c.acceptanceCriteria.find((x) => x.decisionRefs.length > 0)!;
    const t = traceCriterion(c, evidence, withDecision.id)!;
    expect(t.evidence.length).toBeGreaterThan(0);
    expect(t.components.length).toBeGreaterThan(0);
    expect(t.tests.length).toBeGreaterThan(0);
    expect(t.steps.length).toBeGreaterThan(0);
    expect(t.decisions.map((d) => d.questionId)).toEqual(withDecision.decisionRefs.filter((q) => c.decisions.some((d) => d.questionId === q)));
    for (const e of t.evidence) expect(evidence.some((x) => x.id === e.id)).toBe(true);
  });

  it("surfaces open questions for a blocked criterion", () => {
    const c = contentOf(brief);
    const blocked = c.acceptanceCriteria.find((x) => x.dependsOnOpen.length > 0)!;
    expect(traceCriterion(c, evidence, blocked.id)!.openQuestions.length).toBeGreaterThan(0);
  });

  it("returns null for an unknown criterion", () => {
    expect(traceCriterion(contentOf(brief), evidence, "ac-404")).toBeNull();
  });
});

describe("exports", () => {
  it("Markdown labels each content kind, cites evidence and discloses fixture + demo origin", () => {
    const md = exportMarkdown(detail);
    expect(md).toContain("FIXTURE OUTPUT");
    expect(md).toContain("DEMONSTRATION DATA");
    for (const tag of ["[OBSERVED]", "[PROPOSED]", "[ASSUMED]", "[UNRESOLVED]"]) expect(md).toContain(tag);
    expect(md).toContain("## Evidence index");
    expect(md).toMatch(/`src\/notifications\/dispatcher\.ts:\d+-\d+`/);
    expect(md).not.toContain("§");
    expect(md).not.toContain("demo-not-a-real-secret");
  });

  it("JSON carries the snapshot pin, evidence hashes and verification", () => {
    const j = JSON.parse(exportJson(detail)) as { snapshot: { id: string }; evidence: { contentHash: string }[]; verification: unknown; isDemoRepository: boolean; producedBy: { kind: string } };
    expect(j.snapshot.id).toBe(detail.inspection!.snapshotId);
    expect(j.evidence.every((e) => e.contentHash.length === 64)).toBe(true);
    expect(j.verification).toBeTruthy();
    expect(j.isDemoRepository).toBe(true);
    expect(j.producedBy.kind).toBe("fixture");
  });

  it("refuses to export a session without a brief", () => {
    expect(() => exportMarkdown({ ...detail, brief: null })).toThrow();
    expect(() => exportJson({ ...detail, brief: null })).toThrow();
    expect(() => exportGithubIssue({ ...detail, brief: null })).toThrow();
  });

  it("GitHub-issue export uses task-list checkboxes and drops the audit-trail evidence index", () => {
    const issue = exportGithubIssue(detail);
    expect(issue).toContain("FIXTURE OUTPUT");
    expect(issue).toContain("DEMONSTRATION DATA");
    expect(issue).toContain("- [ ] **ac-1**");
    expect(issue).not.toContain("## Evidence index");
    expect(issue).not.toContain("§");
    expect(issue).not.toContain("demo-not-a-real-secret");
  });
});
