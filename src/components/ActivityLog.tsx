import type { ActivityEntry, Usage } from "@/shared/schemas";

export function ActivityLog({ entries, usage }: { entries: ActivityEntry[]; usage: Usage }) {
  return (
    <section aria-label="Activity log" style={{ marginTop: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <h2>Activity log</h2>
        <span className="small muted">
          {usage.calls} model call(s) · {usage.inputTokens.toLocaleString()} in / {usage.outputTokens.toLocaleString()} out tokens{usage.estimated ? " (fixture estimate)" : ""}
          {usage.costUsd !== null ? ` · $${usage.costUsd.toFixed(4)}` : " · cost unknown (set READYSPEC_PRICE_* to compute)"}
        </span>
      </div>
      <div className="log" role="log">
        {entries.length === 0 && <span className="muted">No activity yet.</span>}
        {entries.map((a) => (
          <div key={a.id} className={`lvl-${a.level}`}>
            <span className="muted mono">{a.at.slice(11, 19)}</span> <strong>{a.stage}</strong> {a.message}
          </div>
        ))}
      </div>
    </section>
  );
}
