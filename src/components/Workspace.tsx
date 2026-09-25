"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionDetail, SessionStatus } from "@/shared/schemas";
import { contentOf } from "@/shared/brief-edit";
import { traceCriterion } from "@/shared/trace";
import { ActivityLog } from "./ActivityLog";
import { api } from "./api";
import { DemoBanner, FixtureBanner, KindLegend, ProviderBadge, StatusBadge } from "./Badges";
import { BriefPanel } from "./BriefPanel";
import { EvidenceExplorer } from "./EvidenceExplorer";
import { TicketPanel } from "./TicketPanel";

const ACTIVE: SessionStatus[] = ["inspecting", "analyzing", "briefing"];

const STEPS = ["Investigate", "Consent", "Clarify", "Brief", "Review"];
function stepIndex(d: SessionDetail): number {
  const s = d.session.status;
  if (s === "approved") return 5;
  if (s === "review") return 4;
  if (s === "briefing") return 3;
  if (s === "awaiting_answers" || s === "analyzing") return 2;
  if (s === "awaiting_consent") return 1;
  if (s === "failed" || s === "cancelled") return d.error?.stage === "brief" ? 3 : d.error?.stage === "review" ? 4 : 2;
  return 0;
}

export function Workspace({ id }: { id: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [criterion, setCriterion] = useState<string | null>(null);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDetail(await api.detail(id));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    let live = true;
    api
      .detail(id)
      .then((d) => live && setDetail(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [id]);

  const active = detail ? detail.running || ACTIVE.includes(detail.session.status) : false;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void refresh(), 700);
    return () => clearInterval(t);
  }, [active, refresh]);

  const act = useCallback(
    (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      fn()
        .catch((e: Error) => setError(e.message))
        .finally(() => {
          setBusy(false);
          void refresh();
        });
    },
    [refresh],
  );

  const trace = useMemo(() => {
    if (!detail?.brief || !criterion) return null;
    return traceCriterion(contentOf(detail.brief), detail.evidence, criterion);
  }, [detail, criterion]);
  const criterionText = detail?.brief?.acceptanceCriteria.find((c) => c.id === criterion)?.text ?? "";

  if (!detail) {
    return <main><p className="muted" style={{ padding: 24 }}>{error ?? "Loading session…"}</p></main>;
  }
  const s = detail.session;
  const step = stepIndex(detail);

  return (
    <main>
      <div className="app-bar">
        <Link href="/" className="brand">ReadySpec</Link>
        <span className="title">{s.title}</span>
        <StatusBadge status={s.status} />
        {s.isDemo && <span className="badge neutral">Demo data</span>}
        <ProviderBadge provider={s.provider} />
        {detail.running && <button className="btn danger" type="button" onClick={() => act(() => api.cancel(id))}>Cancel</button>}
        {(s.status === "failed" || s.status === "cancelled") && detail.error?.recoverable && (
          <button className="btn primary" type="button" disabled={busy} onClick={() => act(() => api.resume(id))}>Resume from {detail.error.stage}</button>
        )}
        <button className="btn ghost" type="button" disabled={detail.running} onClick={() => act(async () => { await api.remove(id); router.push("/"); })}>Delete</button>
      </div>

      <ol className="stepper" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} className={i < step ? "done" : i === step ? "current" : ""} aria-current={i === step ? "step" : undefined}>
            {i < step && <span aria-hidden>✓ </span>}
            {label}
            {i < step && <span className="sr-only"> (done)</span>}
          </li>
        ))}
      </ol>

      <FixtureBanner provider={s.provider} />
      {s.isDemo && <DemoBanner />}
      {(s.status === "failed" || s.status === "cancelled") && detail.error && (
        <div className={`banner ${s.status === "failed" ? "danger" : ""}`} role="alert">
          <strong>{s.status === "failed" ? "Failed" : "Cancelled"} during {detail.error.stage}.</strong> {detail.error.message} {detail.error.recoverable ? "Your evidence and answers are kept." : ""}
        </div>
      )}
      {error && <div className="banner danger" role="alert">{error}</div>}
      {detail.running && <div className="banner info" role="status">Working… ({s.status})</div>}
      <div style={{ marginBottom: 10 }}><KindLegend /></div>

      <div className="layout">
        <TicketPanel
          detail={detail}
          busy={busy || detail.running}
          onConsentAnalyze={() => act(() => api.analyze(id))}
          onSubmitAnswers={(answers) => act(async () => { if (answers.length) await api.answers(id, answers); await api.generateBrief(id); })}
          onFollowUp={() => act(() => api.followUp(id))}
          onDeclineFollowUp={() => act(() => api.declineFollowUp(id))}
          onSelectEvidence={(eid) => { setEvidenceId(eid); }}
        />
        <EvidenceExplorer
          evidence={detail.evidence}
          pending={detail.pendingEvidence}
          trace={trace}
          criterionText={criterionText}
          selectedEvidence={evidenceId}
          onSelectEvidence={setEvidenceId}
          onClearTrace={() => setCriterion(null)}
          verification={detail.verification}
        />
        <BriefPanel
          detail={detail}
          busy={busy || detail.running}
          act={act}
          selectedCriterion={criterion}
          onSelectCriterion={(cid) => { setCriterion(cid); setEvidenceId(null); }}
          selectedEvidence={evidenceId}
          onSelectEvidence={setEvidenceId}
        />
      </div>

      <ActivityLog entries={detail.activity} usage={detail.usage} />
    </main>
  );
}
