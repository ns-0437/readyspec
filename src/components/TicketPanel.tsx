"use client";

import { useState } from "react";
import type { Question, SessionDetail } from "@/shared/schemas";
import { KindBadge } from "./Badges";
import { EvidenceChips } from "./EvidenceExplorer";

type AnswerState = { mode: "suggest" | "custom" | "defer"; text: string };

function QuestionCard({ q, value, onChange, detail, onSelectEvidence }: { q: Question; value: AnswerState | undefined; onChange: (v: AnswerState) => void; detail: SessionDetail; onSelectEvidence: (id: string) => void }) {
  const state: AnswerState = value ?? { mode: "custom", text: "" };
  const isSuggestion = (t: string) => q.suggestedAnswers.some((s) => s.text.trim() === t.trim());
  return (
    <li className="card stack" aria-label={`Question ${q.id}`}>
      <div className="card-head" style={{ marginBottom: 0 }}>
        <span className="badge neutral">#{q.priority}</span>
        <span className="badge neutral">{q.impact}</span>
        <strong className="grow">{q.text}</strong>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{q.whyItMatters}</p>
      {q.evidenceIds.length > 0 && <EvidenceChips ids={q.evidenceIds} evidence={detail.evidence} onSelect={onSelectEvidence} />}
      {q.suggestedAnswers.length > 0 && (
        <div className="stack">
          <span className="small muted">Suggested answers (options for you to choose — not decisions):</span>
          {q.suggestedAnswers.map((s, i) => (
            <button
              key={i}
              type="button"
              className={`crit${state.mode === "suggest" && state.text === s.text ? " active" : ""}`}
              onClick={() => onChange({ mode: "suggest", text: s.text })}
              aria-pressed={state.mode === "suggest" && state.text === s.text}
            >
              <div>{s.text}</div>
              {s.tradeoff && <div className="small muted">{s.tradeoff}</div>}
            </button>
          ))}
        </div>
      )}
      <textarea
        aria-label={`Your answer to ${q.id}`}
        rows={2}
        placeholder="Or write your own answer…"
        value={state.mode === "defer" ? "" : state.text}
        disabled={state.mode === "defer"}
        onChange={(e) => onChange({ mode: isSuggestion(e.target.value) ? "suggest" : "custom", text: e.target.value })}
      />
      <label className="row small">
        <input type="checkbox" checked={state.mode === "defer"} onChange={(e) => onChange(e.target.checked ? { mode: "defer", text: "" } : { mode: "custom", text: "" })} />
        Leave unresolved — the brief will list it as an open question <KindBadge kind="unresolved" />
      </label>
    </li>
  );
}

export function TicketPanel({ detail, busy, onConsentAnalyze, onSubmitAnswers, onFollowUp, onDeclineFollowUp, onSelectEvidence }: {
  detail: SessionDetail;
  busy: boolean;
  onConsentAnalyze: () => void;
  onSubmitAnswers: (answers: { questionId: string; source: "user" | "suggestion_accepted" | "deferred"; answer: string }[]) => void;
  onFollowUp: () => void;
  onDeclineFollowUp: () => void;
  onSelectEvidence: (id: string) => void;
}) {
  const { session, disclosure, analysis, rounds, decisions } = detail;
  const [consent, setConsent] = useState(false);
  const currentRound = rounds.find((r) => r.round === session.round) ?? null;
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});

  const stateFor = (id: string): AnswerState | undefined => {
    if (answers[id]) return answers[id];
    const d = decisions.find((x) => x.questionId === id);
    if (!d) return undefined;
    return d.source === "deferred" ? { mode: "defer", text: "" } : { mode: d.source === "suggestion_accepted" ? "suggest" : "custom", text: d.answer };
  };
  const complete = currentRound ? currentRound.questions.every((q) => { const s = stateFor(q.id); return s && (s.mode === "defer" || s.text.trim() !== ""); }) : false;

  function submit() {
    if (!currentRound) return;
    onSubmitAnswers(currentRound.questions.map((q) => {
      const s = stateFor(q.id)!;
      return s.mode === "defer" ? { questionId: q.id, source: "deferred" as const, answer: "" } : { questionId: q.id, source: s.mode === "suggest" ? ("suggestion_accepted" as const) : ("user" as const), answer: s.text.trim() };
    }));
  }

  return (
    <div className="col" aria-label="Ticket and decisions">
      <h2 className="col-title">Ticket and decisions</h2>
      <section className="card stack">
        <div className="card-head" style={{ marginBottom: 0 }}><h2 className="grow">Original request</h2></div>
        <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{session.ticket}</p>
        <div className="kv small muted">
          <span>Repository</span><span>{session.repoLabel}{session.isDemo ? " (demo data)" : ""}</span>
          <span>Snapshot</span><span className="mono">{detail.inspection?.snapshotId.slice(0, 12)}{detail.inspection?.commit ? ` · commit ${detail.inspection.commit.slice(0, 8)}` : " · content hash"}</span>
          <span>Files read</span><span>{detail.inspection?.fileCount} ({detail.inspection?.excluded.length} excluded)</span>
        </div>
        {detail.inspection && detail.inspection.excluded.length > 0 && (
          <details>
            <summary>Excluded from reading ({detail.inspection.excluded.length})</summary>
            <ul className="small mono" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {detail.inspection.excluded.slice(0, 40).map((x) => <li key={x.path}>{x.path} — {x.reason}</li>)}
            </ul>
          </details>
        )}
      </section>

      {session.status === "awaiting_consent" && disclosure && (
        <section className="card stack" aria-label="Disclosure and consent">
          <h2>{disclosure.scope === "followup" ? `Review the additional excerpts for round ${session.round}` : "Review what will be sent to the model"}</h2>
          {disclosure.scope === "followup" && <p className="small muted" style={{ margin: 0 }}>Your answers point at code the first search did not include. Only these new excerpts are listed; the earlier ones were already approved.</p>}
          {disclosure.leavesMachine ? (
            <div className="banner">These excerpts and your ticket will be sent to <strong>{disclosure.providerLabel}</strong>. Nothing else from the repository is sent.</div>
          ) : (
            <div className="banner info">Provider: <strong>{disclosure.providerLabel}</strong>. Nothing leaves this machine, but the same excerpts are what a real model would receive.</div>
          )}
          <div className="small muted">{disclosure.items.length} excerpt(s) from {disclosure.sentPaths.length} file(s) · {disclosure.totalChars.toLocaleString()} characters · ≈{disclosure.estTokens.toLocaleString()} input tokens (plus instructions and your ticket, {disclosure.ticketChars} chars)</div>
          <ul className="list small mono">
            {disclosure.items.map((i) => (
              <li key={i.evidenceId}>
                <button type="button" className="chip" onClick={() => onSelectEvidence(i.evidenceId)}>{i.path}:{i.startLine}-{i.endLine}</button>{" "}
                <span className="muted">{i.chars} chars</span>
                {i.injectionFlags.length > 0 && <> <span className="badge k-unresolved">instruction-like text</span></>}
              </li>
            ))}
          </ul>
          <label className="row">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>I have reviewed these excerpts and agree to send them{disclosure.leavesMachine ? "" : " to the fixture provider"}.</span>
          </label>
          <div className="row">
            <button className="btn primary" disabled={!consent || busy} onClick={onConsentAnalyze} type="button">{disclosure.scope === "followup" ? "Send these and ask follow-up questions" : "Analyze repository behavior"}</button>
            {disclosure.scope === "followup" && <button className="btn" disabled={busy} onClick={onDeclineFollowUp} type="button">Skip the new excerpts</button>}
          </div>
        </section>
      )}

      {analysis && (
        <details className="card" open={session.status === "awaiting_answers"}>
          <summary><strong>Investigation findings</strong> — {analysis.observations.length} observed, {analysis.contradictions.length} contradiction(s), {analysis.missingDecisions.length} open decision(s)</summary>
          <div className="stack" style={{ marginTop: 8 }}>
            {analysis.contradictions.map((c) => (
              <div key={c.id} className="item k-unresolved-line"><KindBadge kind="unresolved" /> <span className="small">{c.description}</span> <EvidenceChips ids={c.evidenceIds} evidence={detail.evidence} onSelect={onSelectEvidence} /></div>
            ))}
            {analysis.missingDecisions.map((m) => (
              <div key={m.id} className="item k-unresolved-line"><strong className="small">{m.topic}</strong><div className="small muted">{m.description}</div></div>
            ))}
            {analysis.insufficientEvidence.length > 0 && (
              <div className="item k-assumed-line"><strong className="small">Could not be established from the evidence</strong>
                <ul className="small" style={{ margin: "2px 0 0", paddingLeft: 18 }}>{analysis.insufficientEvidence.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            )}
          </div>
        </details>
      )}

      {session.status === "awaiting_answers" && currentRound && (
        <section className="stack" aria-label="Clarification questions">
          <div className="card-head" style={{ marginBottom: 0 }}>
            <h2 className="grow">Clarification — round {currentRound.round}</h2>
            <span className="small muted">{currentRound.questions.length} of max 5 questions</span>
          </div>
          {currentRound.questions.length === 0 && <div className="card small muted">{currentRound.note || "No further questions are needed."}</div>}
          <ul className="list">
            {currentRound.questions.map((q) => (
              <QuestionCard key={q.id} q={q} value={stateFor(q.id)} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} detail={detail} onSelectEvidence={onSelectEvidence} />
            ))}
          </ul>
          <button className="btn primary" disabled={busy || (currentRound.questions.length > 0 && !complete)} onClick={currentRound.questions.length ? submit : () => onSubmitAnswers([])} type="button">
            {currentRound.questions.length ? "Save answers and generate brief" : "Generate brief"}
          </button>
          {currentRound.questions.length > 0 && !complete && <span className="small muted">Answer each question, or mark it unresolved.</span>}
        </section>
      )}

      {decisions.length > 0 && (
        <section className="card stack" aria-label="Recorded decisions">
          <h2>Recorded decisions</h2>
          <ul className="list">
            {decisions.map((d) => (
              <li key={d.questionId} className={`item ${d.source === "deferred" ? "k-unresolved-line" : ""}`}>
                <div className="small"><strong>{d.question}</strong></div>
                {d.source === "deferred" ? <div className="small"><KindBadge kind="unresolved" /> deferred — still open</div> : <div className="small">{d.answer} <span className="muted">({d.source === "user" ? "your answer" : "accepted suggestion"}, round {d.round})</span></div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {session.status === "review" && session.round < 3 && (
        <button className="btn" onClick={onFollowUp} disabled={busy} type="button">Ask follow-up questions (round {session.round + 1})</button>
      )}
    </div>
  );
}
