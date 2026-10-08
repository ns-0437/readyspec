import { describe, expect, it } from "vitest";
import { approve, changeChoice, editCriterion, exportDraft, newDraft, restoreDraft, serializeDraft } from "../demo/src/draft";
import type { DemoData } from "../demo/src/types";
const data: DemoData = { version: 1, kind: "scripted-demo", commit: "abc", ticket: "Pause notifications", evidence: [] };

describe("browser demo review and drafts", () => {
  it("requires reviewer and acknowledgement, rejecting blank criteria", () => {
    expect(() => approve(newDraft(), "", true)).toThrow();
    expect(() => approve(newDraft(), "NK", false)).toThrow();
    expect(() => approve(editCriterion(newDraft(), "AC-01", " "), "NK", true)).toThrow(/criterion/);
  });
  it("edits and changed decisions invalidate approval; changed decisions discard stale edits", () => {
    const edited = editCriterion(approve(newDraft(), "NK", true), "AC-01", "Reviewed proposal");
    expect(edited.approvedBy).toBeNull();
    const changed = changeChoice(approve(edited, "NK", true), "security", "preserve");
    expect(changed.approvedBy).toBeNull(); expect(changed.edits).toEqual({});
  });
  it("restores choices/edits but never approval or reviewer name", () => {
    const draft = approve(editCriterion(newDraft(), "AC-02", "Custom criterion"), "Private reviewer", true);
    const raw = serializeDraft(draft, "abc");
    expect(raw).not.toContain("Private reviewer");
    expect(restoreDraft(raw, "abc")).toEqual({ ...draft, approvedBy: null });
    expect(restoreDraft(raw, "different-version")).toBeNull();
  });
  it.each(["not json", "null", '{"version":1,"commit":"abc","choices":{},"edits":{}}', "x".repeat(30001)])("handles corrupt stored data", (raw) => {
    expect(restoreDraft(raw, "abc")).toBeNull();
  });
  it("rejects unknown edit IDs and oversized text", () => {
    expect(() => editCriterion(newDraft(), "unknown", "text")).toThrow();
    expect(() => editCriterion(newDraft(), "AC-01", "x".repeat(2001))).toThrow();
  });
  it("labels all exports and preserves unresolved dependencies", () => {
    const draft = approve(newDraft(), "NK", true);
    expect(() => exportDraft(newDraft(), data, "json")).toThrow(/approve/);
    const json = JSON.parse(exportDraft(draft, data, "json"));
    expect(json.kind).toBe("scripted-demo"); expect(json.criteria[0].blockedBy).toContain("security");
    expect(exportDraft(draft, data, "markdown")).toContain("SCRIPTED DEMO");
    expect(exportDraft(draft, data, "issue")).toContain("- [ ] **AC-01**");
  });
  it("escapes authored markup in Markdown exports", () => {
    const draft = approve(editCriterion(newDraft(), "AC-01", "<script>[link](bad)"), "<NK>", true);
    const md = exportDraft(draft, data, "markdown");
    expect(md).not.toContain("<script>"); expect(md).toContain("\\<script\\>");
  });
});
