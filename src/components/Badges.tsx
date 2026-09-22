import type { ContentKind, ProviderInfo, SessionStatus } from "@/shared/schemas";

const KIND_META: Record<ContentKind, { label: string; icon: string; hint: string }> = {
  observed: { label: "Observed", icon: "●", hint: "Supported by repository evidence" },
  proposed: { label: "Proposed", icon: "◆", hint: "A suggested change or acceptance criterion" },
  assumed: { label: "Assumed", icon: "▲", hint: "An explicit, temporary assumption" },
  unresolved: { label: "Unresolved", icon: "?", hint: "A decision that needs a human" },
};

/** Kind is always conveyed by text and a glyph, never by colour alone. */
export function KindBadge({ kind }: { kind: ContentKind }) {
  const m = KIND_META[kind];
  return (
    <span className={`badge k-${kind}`} title={m.hint}>
      <span aria-hidden>{m.icon}</span>
      {m.label}
    </span>
  );
}

export function KindLegend() {
  return (
    <div className="row small muted" aria-label="Content type legend">
      {(Object.keys(KIND_META) as ContentKind[]).map((k) => (
        <KindBadge key={k} kind={k} />
      ))}
    </div>
  );
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  created: "Created",
  inspecting: "Inspecting repository",
  awaiting_consent: "Waiting for your consent",
  analyzing: "Analyzing",
  awaiting_answers: "Waiting for your answers",
  briefing: "Generating brief",
  review: "Ready for review",
  approved: "Approved",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  const cls = status === "approved" ? "ok" : status === "failed" ? "bad" : "neutral";
  return <span className={`badge ${cls}`}>{STATUS_LABEL[status]}</span>;
}

export function ProviderBadge({ provider }: { provider: ProviderInfo }) {
  return provider.kind === "fixture" ? (
    <span className="badge k-assumed" title="Scripted output; no language model is involved">
      ▲ Fixture provider
    </span>
  ) : (
    <span className="badge neutral">{provider.label}</span>
  );
}

export function FixtureBanner({ provider }: { provider: ProviderInfo }) {
  if (provider.kind !== "fixture") return null;
  return (
    <div className="banner" role="note">
      <strong>Fixture provider.</strong> Analysis, questions and briefs are scripted output written for the demonstration, not results from a language model.
      Set <code>ANTHROPIC_API_KEY</code> or <code>GEMINI_API_KEY</code> to run against a real model.
    </div>
  );
}

export function DemoBanner() {
  return (
    <div className="banner info" role="note">
      <strong>Demonstration repository.</strong> The code being analysed is fictional demo data shipped with ReadySpec. It is not BetterMe&apos;s code or system.
    </div>
  );
}
