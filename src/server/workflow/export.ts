import type { EvidenceItem, SessionDetail } from "@/shared/schemas";

const cite = (ids: string[], byId: Map<string, EvidenceItem>): string =>
  ids.length ? ids.map((i) => { const e = byId.get(i); return e ? `\`${e.path}:${e.startLine}-${e.endLine}\` (${i})` : `${i} (missing)`; }).join(", ") : "none";

/** Machine-readable export: the brief plus everything needed to check it later. */
export function exportJson(d: SessionDetail): string {
  if (!d.brief) throw new Error("No brief to export");
  return JSON.stringify(
    {
      format: "readyspec.brief/v1",
      exportedAt: new Date().toISOString(),
      producedBy: d.brief.producedBy,
      isFixtureOutput: d.brief.producedBy.kind === "fixture",
      isDemoRepository: d.session.isDemo,
      session: { id: d.session.id, ticket: d.session.ticket, repository: d.session.repoLabel },
      snapshot: { id: d.inspection?.snapshotId ?? null, commit: d.inspection?.commit ?? null },
      brief: d.brief,
      decisions: d.decisions,
      evidence: d.evidence.map((e) => ({ id: e.id, path: e.path, startLine: e.startLine, endLine: e.endLine, contentHash: e.contentHash, symbol: e.symbol, explanation: e.explanation, excerpt: e.excerpt })),
      verification: d.verification,
    },
    null,
    2,
  );
}

export function exportMarkdown(d: SessionDetail): string {
  const b = d.brief;
  if (!b) throw new Error("No brief to export");
  const byId = new Map(d.evidence.map((e) => [e.id, e]));
  const L: string[] = [];
  const push = (...s: string[]) => L.push(...s);

  push(`# ${b.title}`, "");
  if (b.producedBy.kind === "fixture") push("> **FIXTURE OUTPUT.** This brief was produced by the scripted fixture provider, not by a language model.", "");
  if (d.session.isDemo) push("> **DEMONSTRATION DATA.** The repository analysed is fictional demo code shipped with ReadySpec.", "");
  push(
    `- **Status:** ${b.status}${b.approval ? ` (approved by ${b.approval.reviewer} on ${b.approval.approvedAt}${b.approval.note ? `: ${b.approval.note}` : ""})` : " (not approved)"}`,
    `- **Repository:** ${d.session.repoLabel} @ snapshot \`${d.inspection?.snapshotId.slice(0, 12) ?? "?"}\`${d.inspection?.commit ? `, commit \`${d.inspection.commit.slice(0, 10)}\`` : ""}`,
    `- **Produced by:** ${b.producedBy.label}; revision ${b.revision}`,
  );
  const v = d.verification;
  if (v) push(`- **Verification:** ${v.passed ? "passed" : "FAILED"}; ${v.citations.valid}/${v.citations.checked} citations valid; ${v.issues.filter((i) => i.severity === "error").length} error(s), ${v.issues.filter((i) => i.severity === "warning").length} warning(s)`);
  push("", "Legend: **[OBSERVED]** supported by cited code, **[PROPOSED]** a suggested change, **[ASSUMED]** a stated temporary assumption, **[UNRESOLVED]** needs a human decision.", "");

  push("## Requested outcome", "", b.requestedOutcome, "");
  push("## Scope", "", "**In scope** [PROPOSED]", ...b.scope.inScope.map((s) => `- ${s}`), "", "**Out of scope** [PROPOSED]", ...b.scope.outOfScope.map((s) => `- ${s}`), "");
  push("## Existing behavior [OBSERVED]", "");
  for (const o of b.existingBehavior) push(`- **${o.id}** ${o.statement}`, `  - Evidence: ${cite(o.evidenceIds, byId)}`);
  if (!b.existingBehavior.length) push("_No existing behavior could be established from the repository evidence._");
  push("", "## Decisions", "");
  for (const x of b.decisions) push(`- **${x.questionId}** ${x.question}`, `  - Answer (${x.source === "user" ? "human" : "accepted suggestion"}): ${x.answer}`);
  if (!b.decisions.length) push("_No decisions recorded._");
  push("", "## Open questions [UNRESOLVED]", "");
  for (const q of b.openQuestions) push(`- **${q.id}** ${q.text}${q.questionId ? ` (from ${q.questionId})` : ""}`);
  if (!b.openQuestions.length) push("_None._");

  push("", "## Acceptance criteria [PROPOSED]", "");
  for (const c of b.acceptanceCriteria) {
    push(`### ${c.id}: ${c.text}`, "");
    push(`- Evidence: ${cite(c.evidenceIds, byId)}`);
    push(`- Affected components: ${c.componentIds.map((k) => { const comp = b.components.find((x) => x.id === k); return comp ? `\`${comp.path}\`` : k; }).join(", ") || "none"}`);
    push(`- Tests: ${c.testIds.map((k) => { const t = b.tests.find((x) => x.id === k); return t ? `${k} (${t.level}${t.testPath ? `, \`${t.testPath}\`` : ""})` : k; }).join(", ") || "none"}`);
    if (c.decisionRefs.length) push(`- Relies on decisions: ${c.decisionRefs.join(", ")}`);
    if (c.dependsOnOpen.length) push(`- **Blocked by unresolved:** ${c.dependsOnOpen.join(", ")}`);
    push("");
  }
  push("## Affected components", "");
  for (const c of b.components) push(`- **${c.id}** \`${c.path}\` (${c.change}): ${c.role}${c.evidenceIds.length ? ` — evidence: ${cite(c.evidenceIds, byId)}` : ""}`);
  push("", "## Implementation steps [PROPOSED]", "");
  b.steps.forEach((s, i) => push(`${i + 1}. **${s.id}** ${s.text} (delivers ${s.criterionIds.join(", ") || "no criterion"})`));
  push("", "## Test plan [PROPOSED]", "");
  for (const t of b.tests) push(`- **${t.id}** [${t.level}] ${t.description}${t.testPath ? ` — \`${t.testPath}\`` : ""} (covers ${t.criterionIds.join(", ")})`);
  push("", "## Risks", "");
  for (const r of b.risks) push(`- **${r.id}** [${r.severity}] ${r.text}${r.evidenceIds.length ? ` — evidence: ${cite(r.evidenceIds, byId)}` : ""}`);
  if (!b.risks.length) push("_None identified._");
  push("", "## Assumptions [ASSUMED]", "");
  for (const a of b.assumptions) push(`- **${a.id}** ${a.text}${a.replaceWhen ? ` _Replace when: ${a.replaceWhen}_` : ""}`);
  if (!b.assumptions.length) push("_None._");

  push("", "## Evidence index", "");
  const used = new Set<string>([...b.existingBehavior, ...b.acceptanceCriteria, ...b.components, ...b.risks].flatMap((x) => x.evidenceIds));
  for (const id of used) { const e = byId.get(id); if (e) push(`- ${id}: \`${e.path}:${e.startLine}-${e.endLine}\`, sha256 \`${e.contentHash.slice(0, 12)}\`${e.explanation ? ` — ${e.explanation}` : ""}`); }
  if (v && v.issues.length) {
    push("", "## Verification findings", "");
    for (const i of v.issues) push(`- ${i.severity.toUpperCase()} \`${i.code}\`${i.itemId ? ` (${i.itemId})` : ""}: ${i.message}`);
  }
  push("");
  return L.join("\n");
}

/**
 * GitHub-issue-shaped export: a shorter variant with task-list checkboxes for acceptance criteria,
 * steps and tests, meant to be pasted straight into an issue body. Drops the full evidence index
 * and per-item citation lists the Markdown export carries for audit purposes -- an issue tracks
 * work, it doesn't need to double as the audit trail; that stays available via the Markdown/JSON
 * export for anyone who needs it.
 */
export function exportGithubIssue(d: SessionDetail): string {
  const b = d.brief;
  if (!b) throw new Error("No brief to export");
  const L: string[] = [];
  const push = (...s: string[]) => L.push(...s);

  if (b.producedBy.kind === "fixture") push("> **FIXTURE OUTPUT.** This brief was produced by the scripted fixture provider, not by a language model.", "");
  if (d.session.isDemo) push("> **DEMONSTRATION DATA.** The repository analysed is fictional demo code shipped with ReadySpec.", "");

  push(b.requestedOutcome, "");
  if (b.scope.inScope.length) push(`**In scope:** ${b.scope.inScope.join("; ")}`);
  if (b.scope.outOfScope.length) push(`**Out of scope:** ${b.scope.outOfScope.join("; ")}`);
  push("");

  push("### Acceptance criteria", "");
  for (const c of b.acceptanceCriteria) {
    const blocked = c.dependsOnOpen.length ? ` _(blocked by unresolved: ${c.dependsOnOpen.join(", ")})_` : "";
    push(`- [ ] **${c.id}** ${c.text}${blocked}`);
  }
  if (!b.acceptanceCriteria.length) push("_None._");

  push("", "### Steps", "");
  b.steps.forEach((s) => push(`- [ ] ${s.text}`));
  if (!b.steps.length) push("_None._");

  push("", "### Tests", "");
  for (const t of b.tests) push(`- [ ] [${t.level}] ${t.description}${t.testPath ? ` (\`${t.testPath}\`)` : ""}`);
  if (!b.tests.length) push("_None._");

  if (b.openQuestions.length) {
    push("", "### Open questions — need a decision before or while implementing", "");
    for (const q of b.openQuestions) push(`- [ ] ${q.text}`);
  }

  if (b.risks.length) {
    push("", "### Risks", "");
    for (const r of b.risks) push(`- **[${r.severity}]** ${r.text}`);
  }

  if (b.assumptions.length) {
    push("", "### Assumptions [ASSUMED]", "");
    for (const a of b.assumptions) push(`- ${a.text}${a.replaceWhen ? ` _(replace when: ${a.replaceWhen})_` : ""}`);
  }

  push("", `<sub>Generated by ReadySpec from \`${d.session.repoLabel}\`. Evidence-linked full brief: export as Markdown or JSON.</sub>`);
  return L.join("\n");
}
