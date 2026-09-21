"use client";

import { useEffect, useRef, useState } from "react";
import type { EvidenceItem, VerificationReport } from "@/shared/schemas";
import type { CriterionTrace } from "@/shared/trace";
import { KindBadge } from "./Badges";

export function EvidenceChips({ ids, evidence, onSelect, activeId }: { ids: string[]; evidence: EvidenceItem[]; onSelect: (id: string) => void; activeId?: string | null }) {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  if (ids.length === 0) return <span className="small muted">no code cited</span>;
  return (
    <span className="row" style={{ gap: 4 }}>
      {ids.map((id) => {
        const e = byId.get(id);
        return (
          <button key={id} type="button" className={`chip${activeId === id ? " active" : ""}`} onClick={() => onSelect(id)} title={e ? `${e.path}:${e.startLine}-${e.endLine}` : "missing evidence"}>
            {e ? `${e.path.split("/").pop()}:${e.startLine}-${e.endLine}` : `${id} (missing)`}
          </button>
        );
      })}
    </span>
  );
}

function CodeBlock({ e }: { e: EvidenceItem }) {
  const lines = e.excerpt.split("\n");
  return (
    <div className="code" tabIndex={0} aria-label={`Code from ${e.path} lines ${e.startLine} to ${e.endLine}`}>
      <pre>
        {lines.map((l, i) => (
          <span className="ln" key={i}>
            <i>{e.startLine + i}</i>
            {l || " "}
          </span>
        ))}
      </pre>
    </div>
  );
}

export function TraceInspector({ trace, evidence, activeEvidence, onSelectEvidence, onClear, criterionText }: {
  trace: CriterionTrace;
  evidence: EvidenceItem[];
  activeEvidence: string | null;
  onSelectEvidence: (id: string) => void;
  onClear: () => void;
  criterionText: string;
}) {
  return (
    <section className="card sticky" aria-label="Traceability inspector" style={{ borderColor: "var(--accent)" }}>
      <div className="card-head">
        <KindBadge kind="proposed" />
        <strong className="grow">Criterion {trace.criterionId}</strong>
        <button className="btn small ghost" onClick={onClear} type="button">Clear</button>
      </div>
      <p style={{ margin: "0 0 8px" }}>{criterionText}</p>
      <div className="stack">
        <div>
          <h3>Source evidence <KindBadge kind="observed" /></h3>
          <EvidenceChips ids={trace.evidence.map((e) => e.id)} evidence={evidence} onSelect={onSelectEvidence} activeId={activeEvidence} />
        </div>
        <div>
          <h3>Affected components</h3>
          {trace.components.length === 0 ? <span className="small muted">none listed</span> : (
            <ul className="list">
              {trace.components.map((c) => (
                <li key={c.id} className="small"><code>{c.path}</code> <span className="badge neutral">{c.change}</span> <span className="muted">{c.role}</span></li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3>Proposed tests <KindBadge kind="proposed" /></h3>
          {trace.tests.length === 0 ? <span className="small" style={{ color: "var(--danger)" }}>No test linked — verification will fail this criterion.</span> : (
            <ul className="list">
              {trace.tests.map((t) => (
                <li key={t.id} className="small"><span className="badge neutral">{t.level}</span> {t.description}{t.testPath && <> <code>{t.testPath}</code></>}</li>
              ))}
            </ul>
          )}
        </div>
        {(trace.decisions.length > 0 || trace.openQuestions.length > 0) && (
          <div>
            <h3>Decisions</h3>
            <ul className="list">
              {trace.decisions.map((d) => (
                <li key={d.questionId} className="small"><strong>{d.question}</strong> → {d.answer}</li>
              ))}
              {trace.openQuestions.map((q) => (
                <li key={q.id} className="small"><KindBadge kind="unresolved" /> {q.text}</li>
              ))}
            </ul>
          </div>
        )}
        {trace.steps.length > 0 && (
          <div>
            <h3>Delivered by</h3>
            <span className="small">{trace.steps.map((s) => s.id).join(", ")}</span>
          </div>
        )}
      </div>
    </section>
  );
}

export function EvidenceExplorer({ evidence, pending = [], trace, criterionText, selectedEvidence, onSelectEvidence, onClearTrace, verification }: {
  evidence: EvidenceItem[];
  pending?: EvidenceItem[];
  trace: CriterionTrace | null;
  criterionText: string;
  selectedEvidence: string | null;
  onSelectEvidence: (id: string | null) => void;
  onClearTrace: () => void;
  verification: VerificationReport | null;
}) {
  const [onlyRelated, setOnlyRelated] = useState(false);
  const refs = useRef<Map<string, HTMLElement>>(new Map());
  const relatedIds = new Set(trace?.evidence.map((e) => e.id) ?? []);
  const invalid = new Map((verification?.citations.invalid ?? []).map((i) => [i.evidenceId, i.reason]));

  useEffect(() => {
    if (selectedEvidence) refs.current.get(selectedEvidence)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedEvidence]);

  const pendingIds = new Set(pending.map((e) => e.id));
  const shown = [...(trace && onlyRelated ? evidence.filter((e) => relatedIds.has(e.id)) : evidence), ...pending];

  return (
    <div className="col" aria-label="Evidence explorer">
      <h2 className="col-title">Evidence explorer</h2>
      {trace && (
        <TraceInspector trace={trace} evidence={evidence} activeEvidence={selectedEvidence} onSelectEvidence={onSelectEvidence} onClear={onClearTrace} criterionText={criterionText} />
      )}
      {evidence.length === 0 && <div className="card muted">No relevant code was found for this ticket. The agent must report that current behavior cannot be established.</div>}
      {trace && evidence.length > 0 && (
        <label className="row small">
          <input type="checkbox" checked={onlyRelated} onChange={(e) => setOnlyRelated(e.target.checked)} /> Show only evidence for this criterion
        </label>
      )}
      {shown.map((e) => {
        const related = relatedIds.has(e.id);
        const cls = ["card", trace ? (related ? "related" : "dim") : "", selectedEvidence === e.id ? "selected" : ""].join(" ");
        return (
          <article key={e.id} className={cls} ref={(el) => { if (el) refs.current.set(e.id, el); else refs.current.delete(e.id); }} aria-label={`Evidence ${e.path}`}>
            <div className="card-head">
              <code className="grow" style={{ overflowWrap: "anywhere" }}>{e.path}:{e.startLine}-{e.endLine}</code>
              {e.symbol && <span className="badge neutral">{e.symbol}</span>}
              {pendingIds.has(e.id) && <span className="badge k-assumed" title="Shown for review; not sent until you consent">not yet sent</span>}
              {invalid.has(e.id) && <span className="badge bad" title={invalid.get(e.id)}>invalid citation</span>}
              {e.injectionFlags.length > 0 && <span className="badge k-unresolved" title={e.injectionFlags.join(", ")}>Contains instruction-like text (treated as data)</span>}
            </div>
            <CodeBlock e={e} />
            {e.explanation && <p className="small" style={{ margin: "8px 0 0" }}><strong>Why it matters:</strong> {e.explanation}</p>}
            <p className="small muted" style={{ margin: "4px 0 0" }}>Retrieved: {e.retrievalReason} · score {e.score} · {e.id}</p>
          </article>
        );
      })}
    </div>
  );
}
