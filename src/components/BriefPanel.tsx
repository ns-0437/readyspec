"use client";

import { useState } from "react";
import { contentOf, removeItem, removeScopeItem, setItemText, setScopeItem, type ListKey } from "@/shared/brief-edit";
import type { BriefContent, SessionDetail, SupportResult } from "@/shared/schemas";
import { KindBadge } from "./Badges";
import { EvidenceChips } from "./EvidenceExplorer";
import { api } from "./api";

function Editable({ text, onChange, onRemove, disabled, label }: { text: string; onChange: (v: string) => void; onRemove?: () => void; disabled: boolean; label: string }) {
  const [editing, setEditing] = useState(false);
  if (editing && !disabled) {
    return (
      <div className="stack">
        <textarea aria-label={`Edit ${label}`} value={text} onChange={(e) => onChange(e.target.value)} rows={3} autoFocus />
        <div className="row"><button className="btn small" type="button" onClick={() => setEditing(false)}>Done</button></div>
      </div>
    );
  }
  return (
    <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
      <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{text}</span>
      {!disabled && (
        <span className="row" style={{ flexWrap: "nowrap", gap: 2 }}>
          <button className="btn small ghost" type="button" onClick={() => setEditing(true)} aria-label={`Edit ${label}`}>Edit</button>
          {onRemove && <button className="btn small ghost" type="button" onClick={onRemove} aria-label={`Remove ${label}`}>Remove</button>}
        </span>
      )}
    </div>
  );
}

const verdictBadge = (r: SupportResult | undefined) => {
  if (!r) return null;
  const cls = r.verdict === "supported" ? "ok" : r.verdict === "weak" ? "neutral" : "bad";
  return <span className={`badge ${cls}`} title={r.detail}>{r.verdict === "supported" ? "supported by cited code" : r.verdict.replace("_", " ")}</span>;
};

export function BriefPanel({ detail, busy, act, selectedCriterion, onSelectCriterion, selectedEvidence, onSelectEvidence }: {
  detail: SessionDetail;
  busy: boolean;
  act: (fn: () => Promise<unknown>) => void;
  selectedCriterion: string | null;
  onSelectCriterion: (id: string | null) => void;
  selectedEvidence: string | null;
  onSelectEvidence: (id: string) => void;
}) {
  const { brief, verification, evidence, session } = detail;
  const [draft, setDraft] = useState<{ revision: number; content: BriefContent } | null>(null);
  const [reviewer, setReviewer] = useState("");
  const [note, setNote] = useState("");
  const [ack, setAck] = useState(false);

  if (!brief) {
    return (
      <div className="col" aria-label="Implementation brief">
        <h2 className="col-title">Implementation brief</h2>
        <div className="card muted">
          {session.status === "briefing" ? "Generating the brief…" : "The brief appears here after you answer the clarification questions."}
        </div>
      </div>
    );
  }

  const working = draft && draft.revision === brief.revision ? draft.content : contentOf(brief);
  const dirty = draft !== null && draft.revision === brief.revision && JSON.stringify(draft.content) !== JSON.stringify(contentOf(brief));
  const update = (next: BriefContent) => setDraft({ revision: brief.revision, content: next });
  const locked = busy || session.status === "briefing";
  const supportById = new Map<string, SupportResult>();
  for (const r of verification?.support ?? []) if (r.method === "lexical") supportById.set(r.itemId, r);
  const errors = verification?.issues.filter((i) => i.severity === "error") ?? [];
  const warnings = verification?.issues.filter((i) => i.severity === "warning") ?? [];
  const issueFor = (id: string) => verification?.issues.filter((i) => i.itemId === id) ?? [];
  const stale = verification && verification.briefRevision !== brief.revision;

  const edit = (key: ListKey, id: string, label: string, text: string) => (
    <Editable label={`${label} ${id}`} text={text} disabled={locked} onChange={(v) => update(setItemText(working, key, id, v))} onRemove={() => update(removeItem(working, key, id))} />
  );

  return (
    <div className="col" aria-label="Implementation brief">
      <h2 className="col-title">Implementation brief</h2>

      {brief.producedBy.kind === "fixture" && <div className="banner" role="note"><strong>Fixture output.</strong> Scripted, not produced by a model — exports carry this label.</div>}

      <section className="card stack">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <h2 className="grow">{working.title}</h2>
          <span className={`badge ${brief.status === "approved" ? "ok" : "neutral"}`}>{brief.status === "approved" ? `Approved by ${brief.approval?.reviewer}` : "Draft"}</span>
          <span className="badge neutral">rev {brief.revision}</span>
        </div>
        <div className="row small muted">Produced by {brief.producedBy.label}</div>
        <div><h3>Requested outcome</h3><p style={{ margin: "2px 0 0" }}>{working.requestedOutcome}</p></div>
        <div className="grid2">
          {(["inScope", "outOfScope"] as const).map((side) => (
            <div key={side}>
              <h3>{side === "inScope" ? "In scope" : "Out of scope"} <KindBadge kind="proposed" /></h3>
              <ul className="list" style={{ marginTop: 4 }}>
                {working.scope[side].map((s, i) => (
                  <li key={`${side}-${i}`} className="small"><Editable label={`${side} item ${i + 1}`} text={s} disabled={locked} onChange={(v) => update(setScopeItem(working, side, i, v))} onRemove={() => update(removeScopeItem(working, side, i))} /></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {verification && (
        <section className="card stack" aria-label="Verification">
          <div className="card-head" style={{ marginBottom: 0 }}>
            <h2 className="grow">Verification</h2>
            <span className={`badge ${verification.passed && !stale ? "ok" : "bad"}`}>{stale ? "out of date" : verification.passed ? "passed" : "failed"}</span>
          </div>
          <div className="small muted">
            {verification.citations.valid}/{verification.citations.checked} citations valid against snapshot {verification.snapshotId.slice(0, 10)} · {verification.coverage.criteriaWithTest}/{verification.coverage.criteria} criteria have a test · {verification.coverage.stepsLinked}/{verification.coverage.steps} steps linked · {errors.length} error(s), {warnings.length} warning(s)
          </div>
          <div className="small muted">A valid citation proves the lines exist; the &quot;supported&quot; label is a separate lexical check that the claim&apos;s identifiers appear in those lines.</div>
          {verification.issues.length > 0 && (
            <ul className="list">
              {verification.issues.map((i, n) => (
                <li key={n} className="issue"><span className={`badge ${i.severity === "error" ? "bad" : "neutral"}`}>{i.severity}</span><span>{i.message}</span></li>
              ))}
            </ul>
          )}
          {dirty && <div className="small muted">Unsaved edits are not yet verified. Save to re-run checks.</div>}
        </section>
      )}

      <section className="card stack" aria-label="Existing behavior">
        <div className="card-head" style={{ marginBottom: 0 }}><h2 className="grow">Existing behavior</h2><KindBadge kind="observed" /></div>
        {working.existingBehavior.length === 0 && <span className="small muted">No existing behavior could be established from the evidence.</span>}
        <ul className="list">
          {working.existingBehavior.map((o) => (
            <li key={o.id} className="item k-observed-line">
              <div className="row small muted"><strong>{o.id}</strong>{verdictBadge(supportById.get(o.id))}</div>
              {edit("existingBehavior", o.id, "observation", o.statement)}
              <EvidenceChips ids={o.evidenceIds} evidence={evidence} onSelect={onSelectEvidence} activeId={selectedEvidence} />
            </li>
          ))}
        </ul>
      </section>

      <section className="card stack" aria-label="Decisions and open questions">
        <h2>Decisions</h2>
        {working.decisions.length === 0 && <span className="small muted">No answers recorded.</span>}
        <ul className="list">
          {working.decisions.map((d) => (
            <li key={d.questionId} className="item"><div className="small"><strong>{d.question}</strong></div><div className="small">{d.answer} <span className="muted">({d.source === "user" ? "your answer" : "accepted suggestion"})</span></div></li>
          ))}
        </ul>
        <div className="card-head" style={{ marginBottom: 0 }}><h2 className="grow">Open questions</h2><KindBadge kind="unresolved" /></div>
        {working.openQuestions.length === 0 && <span className="small muted">None — every question was answered.</span>}
        <ul className="list">
          {working.openQuestions.map((q) => <li key={q.id} className="item k-unresolved-line">{edit("openQuestions", q.id, "open question", q.text)}</li>)}
        </ul>
      </section>

      <section className="stack" aria-label="Acceptance criteria">
        <div className="card-head" style={{ marginBottom: 0 }}><h2 className="grow">Acceptance criteria</h2><KindBadge kind="proposed" /></div>
        <p className="small muted" style={{ margin: 0 }}>Select a criterion to see its evidence, affected components and proposed tests together.</p>
        <ul className="list">
          {working.acceptanceCriteria.map((c) => {
            const active = selectedCriterion === c.id;
            const blocked = c.dependsOnOpen.length > 0;
            return (
              <li key={c.id}>
                <div className={`crit${active ? " active" : ""}`} role="button" tabIndex={0} aria-pressed={active}
                  onClick={() => onSelectCriterion(active ? null : c.id)}
                  onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelectCriterion(active ? null : c.id); } }}>
                  <div className="row small muted"><strong>{c.id}</strong>
                    {blocked && <KindBadge kind="unresolved" />}
                    <span>{c.evidenceIds.length} evidence · {c.componentIds.length} component(s) · {c.testIds.length} test(s)</span>
                    {issueFor(c.id).some((i) => i.severity === "error") && <span className="badge bad">needs attention</span>}
                  </div>
                  <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    {edit("acceptanceCriteria", c.id, "criterion", c.text)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card stack" aria-label="Affected components and steps">
        <h2>Affected components</h2>
        <ul className="list">
          {working.components.map((c) => (
            <li key={c.id} className="item k-proposed-line small">
              <div className="row"><code>{c.path}</code><span className="badge neutral">{c.change}</span></div>
              {edit("components", c.id, "component role", c.role)}
              {c.evidenceIds.length > 0 && <EvidenceChips ids={c.evidenceIds} evidence={evidence} onSelect={onSelectEvidence} activeId={selectedEvidence} />}
            </li>
          ))}
        </ul>
        <div className="card-head" style={{ marginBottom: 0 }}><h2 className="grow">Implementation sequence</h2><KindBadge kind="proposed" /></div>
        <ol style={{ margin: 0, paddingLeft: 20 }} className="stack">
          {working.steps.map((s) => <li key={s.id} className="small">{edit("steps", s.id, "step", s.text)}<span className="muted"> delivers {s.criterionIds.join(", ") || "—"}</span></li>)}
        </ol>
      </section>

      <section className="card stack" aria-label="Test plan, risks and assumptions">
        <div className="card-head" style={{ marginBottom: 0 }}><h2 className="grow">Test plan</h2><KindBadge kind="proposed" /></div>
        <ul className="list">
          {working.tests.map((t) => (
            <li key={t.id} className="item k-proposed-line small">
              <div className="row"><span className="badge neutral">{t.level}</span>{t.testPath && <code>{t.testPath}</code>}<span className="muted">covers {t.criterionIds.join(", ") || "nothing"}</span></div>
              {edit("tests", t.id, "test", t.description)}
            </li>
          ))}
        </ul>
        <h2>Risks</h2>
        {working.risks.length === 0 && <span className="small muted">None identified.</span>}
        <ul className="list">
          {working.risks.map((r) => (
            <li key={r.id} className="item small"><div className="row"><span className={`badge ${r.severity === "high" ? "bad" : "neutral"}`}>{r.severity}</span>{verdictBadge(supportById.get(r.id))}</div>{edit("risks", r.id, "risk", r.text)}<EvidenceChips ids={r.evidenceIds} evidence={evidence} onSelect={onSelectEvidence} activeId={selectedEvidence} /></li>
          ))}
        </ul>
        <div className="card-head" style={{ marginBottom: 0 }}><h2 className="grow">Assumptions</h2><KindBadge kind="assumed" /></div>
        {working.assumptions.length === 0 && <span className="small muted">None.</span>}
        <ul className="list">
          {working.assumptions.map((a) => (
            <li key={a.id} className="item k-assumed-line small">{edit("assumptions", a.id, "assumption", a.text)}{a.replaceWhen && <div className="muted">Replace when: {a.replaceWhen}</div>}</li>
          ))}
        </ul>
      </section>

      {dirty && (
        <div className="card row sticky" style={{ justifyContent: "space-between" }}>
          <span>You have unsaved edits.</span>
          <span className="row">
            <button className="btn" type="button" onClick={() => setDraft(null)} disabled={busy}>Discard</button>
            <button className="btn primary" type="button" disabled={busy} onClick={() => act(async () => { await api.saveBrief(session.id, working, brief.revision); setDraft(null); })}>Save and re-verify</button>
          </span>
        </div>
      )}

      <section className="card stack" aria-label="Review and export">
        <h2>Review, approve and export</h2>
        {brief.status === "approved" ? (
          <div className="banner info">Approved by {brief.approval?.reviewer} on {brief.approval?.approvedAt.slice(0, 10)}{brief.approval?.note ? ` — ${brief.approval.note}` : ""}. Editing the brief clears this approval.</div>
        ) : (
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>A person must review the brief before it is approved. Approval needs passing verification for the current revision.</p>
            <input type="text" placeholder="Your name (reviewer)" value={reviewer} onChange={(e) => setReviewer(e.target.value)} aria-label="Reviewer name" />
            <input type="text" placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Approval note" />
            {brief.openQuestions.length > 0 && (
              <label className="row small"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I acknowledge {brief.openQuestions.length} unresolved item(s) remain open.</label>
            )}
            <button className="btn primary" type="button" disabled={busy || dirty || !reviewer.trim() || !verification?.passed || !!stale || session.status !== "review" || (brief.openQuestions.length > 0 && !ack)}
              onClick={() => act(() => api.approve(session.id, reviewer, note, ack))}>
              Approve brief
            </button>
            {!verification?.passed && <span className="small" style={{ color: "var(--danger)" }}>Fix the verification errors above to enable approval.</span>}
          </div>
        )}
        <div className="row">
          <a className="btn" href={api.exportUrl(session.id, "md")} download>Export Markdown</a>
          <a className="btn" href={api.exportUrl(session.id, "json")} download>Export JSON</a>
        </div>
      </section>
    </div>
  );
}
