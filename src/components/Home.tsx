"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ProviderInfo, SessionSummary } from "@/shared/schemas";
import { api } from "./api";
import { FixtureBanner, KindLegend, ProviderBadge, StatusBadge } from "./Badges";

const DEMO_TICKET = "Let users pause notifications while they are away.";

type Repo = { path: string; label: string; isDemo: boolean };

export function Home() {
  const router = useRouter();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [roots, setRoots] = useState<string[]>([]);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [repoPath, setRepoPath] = useState("");
  const [ticket, setTicket] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [r, s] = await Promise.all([api.repositories(), api.sessions()]);
        if (!live) return;
        setRepos(r.repositories);
        setRoots(r.roots);
        setProvider(r.provider);
        setSessions(s.sessions);
        const demo = r.repositories.find((x) => x.label === "demo-repository");
        if (demo) {
          setRepoPath(demo.path);
          setTicket(DEMO_TICKET);
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const selected = repos.find((r) => r.path === repoPath);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { session } = await api.create(repoPath.trim(), ticket);
      router.push(`/sessions/${session.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main>
      <div className="app-bar">
        <span className="brand" style={{ fontSize: 22 }}>ReadySpec</span>
        <span className="muted">Turn a rough ticket into an evidence-backed implementation brief.</span>
      </div>
      {provider && <FixtureBanner provider={provider} />}
      <div className="layout two">
        <form className="card stack" onSubmit={start} aria-label="New session">
          <h2>1. Select a repository and enter a ticket</h2>
          <label className="stack">
            <span className="small muted">Repository (one per session; read-only; must be inside an allowed root)</span>
            <select value={repos.some((r) => r.path === repoPath) ? repoPath : ""} onChange={(e) => { setRepoPath(e.target.value); const r = repos.find((x) => x.path === e.target.value); if (r?.isDemo && r.label === "demo-repository" && !ticket) setTicket(DEMO_TICKET); }}>
              <option value="">Choose a discovered repository…</option>
              {repos.map((r) => (
                <option key={r.path} value={r.path}>{r.label}{r.isDemo ? " (demo fixture)" : ""}</option>
              ))}
            </select>
            <input type="text" value={repoPath} onChange={(e) => setRepoPath(e.target.value)} placeholder="…or type an absolute path" aria-label="Repository path" />
            {roots.length > 0 && <span className="small muted">Allowed roots: {roots.join(", ")}. Add more with READYSPEC_ALLOWED_ROOTS.</span>}
          </label>
          {selected?.isDemo && (
            <div className="banner info">Demonstration repository: fictional code shipped with ReadySpec, not BetterMe&apos;s.</div>
          )}
          <label className="stack">
            <span className="small muted">Ticket</span>
            <textarea value={ticket} onChange={(e) => setTicket(e.target.value)} rows={5} placeholder="Describe the outcome you want…" />
          </label>
          {error && <div className="banner danger" role="alert">{error}</div>}
          <div className="row">
            <button className="btn primary" type="submit" disabled={busy || !repoPath || ticket.trim().length < 10}>
              {busy ? "Investigating…" : "Investigate repository"}
            </button>
            {provider && <ProviderBadge provider={provider} />}
          </div>
          <p className="small muted">
            Investigation is local and deterministic: it snapshots the repository, then finds relevant code. Nothing is sent to a model until you review the excerpts and consent.
          </p>
        </form>

        <div className="col">
          <div className="card stack">
            <h2>Sessions</h2>
            {sessions.length === 0 && <span className="muted">No sessions yet.</span>}
            <ul className="list">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link href={`/sessions/${s.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                    <div className="stack" style={{ gap: 2 }}>
                      <strong>{s.title}</strong>
                      <span className="row small muted">
                        <StatusBadge status={s.status} />
                        <span>{s.repoLabel}</span>
                        {s.isDemo && <span className="badge neutral">Demo data</span>}
                        <ProviderBadge provider={s.provider} />
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="card stack">
            <h2>How content is labelled</h2>
            <KindLegend />
            <p className="small muted">Every statement about existing behavior links to code. Proposals are marked as proposals. Product decisions are never chosen silently.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
