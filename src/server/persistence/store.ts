import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { redactSecrets } from "@/shared/redact";
import {
  ActivityEntry,
  BehaviorAnalysis,
  Brief,
  ClarificationRound,
  Decision,
  Disclosure,
  EvidenceItem,
  ExcludedFile,
  InspectionResult,
  ProviderInfo,
  SessionError,
  SessionStatus,
  SessionSummary,
  Usage,
  VerificationReport,
} from "@/shared/schemas";
import type { Snapshot, SnapshotFile } from "@/server/repository/types";
import { defaultDbPath, openDatabase } from "./db";

type ArtifactKind =
  | "inspection"
  | "evidence"
  | "disclosure"
  | "analysis"
  | "clarification"
  | "brief"
  | "verification";

const ARTIFACT_SCHEMAS = {
  inspection: InspectionResult,
  evidence: z.array(EvidenceItem),
  disclosure: Disclosure,
  analysis: BehaviorAnalysis,
  clarification: ClarificationRound,
  brief: Brief,
  verification: VerificationReport,
} satisfies Record<ArtifactKind, z.ZodType>;

type ArtifactType<K extends ArtifactKind> = z.infer<(typeof ARTIFACT_SCHEMAS)[K]>;

interface SessionRow {
  id: string;
  title: string;
  repo_path: string;
  repo_label: string;
  ticket: string;
  provider_json: string;
  status: string;
  round: number;
  error_json: string | null;
  snapshot_id: string | null;
  is_demo: number;
  created_at: string;
  updated_at: string;
}

export interface NewSession {
  title: string;
  repoPath: string;
  repoLabel: string;
  ticket: string;
  provider: ProviderInfo;
  isDemo: boolean;
}

const now = () => new Date().toISOString();

export class Store {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /* ------------------------------ sessions ------------------------------ */

  createSession(input: NewSession): SessionSummary {
    const id = `s_${crypto.randomBytes(6).toString("hex")}`;
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO sessions (id,title,repo_path,repo_label,ticket,provider_json,status,round,is_demo,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(id, input.title, input.repoPath, input.repoLabel, input.ticket, JSON.stringify(input.provider), "created", 1, input.isDemo ? 1 : 0, ts, ts);
    return this.getSession(id)!;
  }

  private toSummary(row: SessionRow): SessionSummary {
    return SessionSummary.parse({
      id: row.id,
      title: row.title,
      repoLabel: row.repo_label,
      ticket: row.ticket,
      provider: JSON.parse(row.provider_json),
      status: row.status,
      round: row.round,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isDemo: row.is_demo === 1,
    });
  }

  getSession(id: string): SessionSummary | null {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
    return row ? this.toSummary(row) : null;
  }

  getSessionRepoPath(id: string): string | null {
    const row = this.db.prepare("SELECT repo_path FROM sessions WHERE id = ?").get(id) as { repo_path: string } | undefined;
    return row?.repo_path ?? null;
  }

  listSessions(): SessionSummary[] {
    const rows = this.db.prepare("SELECT * FROM sessions ORDER BY created_at DESC").all() as unknown as SessionRow[];
    return rows.map((r) => this.toSummary(r));
  }

  deleteSession(id: string): void {
    for (const table of ["artifacts", "decisions", "activity", "usage"]) {
      this.db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(id);
    }
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    // Snapshots hold repository file contents; drop any that no remaining session references.
    const orphan = "SELECT id FROM snapshots WHERE id NOT IN (SELECT snapshot_id FROM sessions WHERE snapshot_id IS NOT NULL)";
    this.db.exec(`DELETE FROM snapshot_files WHERE snapshot_id IN (${orphan})`);
    this.db.exec(`DELETE FROM snapshots WHERE id IN (${orphan})`);
  }

  setStatus(id: string, status: SessionStatus, error: SessionError | null = null): void {
    this.db
      .prepare("UPDATE sessions SET status = ?, error_json = ?, updated_at = ? WHERE id = ?")
      .run(status, error ? JSON.stringify({ ...error, message: redactSecrets(error.message) }) : null, now(), id);
  }

  getError(id: string): SessionError | null {
    const row = this.db.prepare("SELECT error_json FROM sessions WHERE id = ?").get(id) as { error_json: string | null } | undefined;
    return row?.error_json ? SessionError.parse(JSON.parse(row.error_json)) : null;
  }

  setRound(id: string, round: number): void {
    this.db.prepare("UPDATE sessions SET round = ?, updated_at = ? WHERE id = ?").run(round, now(), id);
  }

  setSnapshotId(id: string, snapshotId: string): void {
    this.db.prepare("UPDATE sessions SET snapshot_id = ?, updated_at = ? WHERE id = ?").run(snapshotId, now(), id);
  }

  getSnapshotId(id: string): string | null {
    const row = this.db.prepare("SELECT snapshot_id FROM sessions WHERE id = ?").get(id) as { snapshot_id: string | null } | undefined;
    return row?.snapshot_id ?? null;
  }

  /* ------------------------------ snapshots ------------------------------ */

  saveSnapshot(s: Snapshot): void {
    const exists = this.db.prepare("SELECT 1 AS x FROM snapshots WHERE id = ?").get(s.id);
    if (exists) return;
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare("INSERT INTO snapshots (id,root,commit_sha,meta_json,created_at) VALUES (?,?,?,?,?)")
        .run(s.id, s.root, s.commit, JSON.stringify({ excluded: s.excluded, truncated: s.truncated }), s.capturedAt);
      const ins = this.db.prepare(
        "INSERT INTO snapshot_files (snapshot_id,path,sha256,size,language,content) VALUES (?,?,?,?,?,?)",
      );
      for (const f of s.files.values()) ins.run(s.id, f.path, f.sha256, f.size, f.language, f.content);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  loadSnapshot(id: string): Snapshot | null {
    const row = this.db.prepare("SELECT * FROM snapshots WHERE id = ?").get(id) as
      | { id: string; root: string; commit_sha: string | null; meta_json: string; created_at: string }
      | undefined;
    if (!row) return null;
    const meta = z.object({ excluded: z.array(ExcludedFile), truncated: z.boolean() }).parse(JSON.parse(row.meta_json));
    const files = new Map<string, SnapshotFile>();
    const rows = this.db.prepare("SELECT path,sha256,size,language,content FROM snapshot_files WHERE snapshot_id = ?").all(id) as unknown as SnapshotFile[];
    for (const f of rows) files.set(f.path, { path: f.path, sha256: f.sha256, size: f.size, language: f.language, content: f.content });
    return { id: row.id, root: row.root, commit: row.commit_sha, files, excluded: meta.excluded, truncated: meta.truncated, capturedAt: row.created_at };
  }

  /* ------------------------------ artifacts ------------------------------ */

  putArtifact<K extends ArtifactKind>(sessionId: string, kind: K, value: ArtifactType<K>, round = 0): void {
    const parsed = ARTIFACT_SCHEMAS[kind].parse(value);
    this.db
      .prepare(
        `INSERT INTO artifacts (session_id,kind,round,json,updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(session_id,kind,round) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      )
      .run(sessionId, kind, round, JSON.stringify(parsed), now());
  }

  getArtifact<K extends ArtifactKind>(sessionId: string, kind: K, round = 0): ArtifactType<K> | null {
    const row = this.db
      .prepare("SELECT json FROM artifacts WHERE session_id = ? AND kind = ? AND round = ?")
      .get(sessionId, kind, round) as { json: string } | undefined;
    return row ? (ARTIFACT_SCHEMAS[kind].parse(JSON.parse(row.json)) as ArtifactType<K>) : null;
  }

  deleteArtifact(sessionId: string, kind: ArtifactKind, round = 0): void {
    this.db.prepare("DELETE FROM artifacts WHERE session_id = ? AND kind = ? AND round = ?").run(sessionId, kind, round);
  }

  listRounds(sessionId: string): ClarificationRound[] {
    const rows = this.db
      .prepare("SELECT json FROM artifacts WHERE session_id = ? AND kind = 'clarification' ORDER BY round")
      .all(sessionId) as unknown as { json: string }[];
    return rows.map((r) => ClarificationRound.parse(JSON.parse(r.json)));
  }

  /* ------------------------------ decisions ------------------------------ */

  putDecision(sessionId: string, d: Decision): void {
    const parsed = Decision.parse(d);
    this.db
      .prepare(
        `INSERT INTO decisions (session_id,question_id,json) VALUES (?,?,?)
         ON CONFLICT(session_id,question_id) DO UPDATE SET json = excluded.json`,
      )
      .run(sessionId, parsed.questionId, JSON.stringify(parsed));
  }

  listDecisions(sessionId: string): Decision[] {
    const rows = this.db.prepare("SELECT json FROM decisions WHERE session_id = ?").all(sessionId) as unknown as { json: string }[];
    return rows.map((r) => Decision.parse(JSON.parse(r.json))).sort((a, b) => a.round - b.round || a.answeredAt.localeCompare(b.answeredAt));
  }

  /* ------------------------------ activity ------------------------------ */

  log(sessionId: string, stage: string, level: "info" | "warn" | "error", message: string): void {
    this.db
      .prepare("INSERT INTO activity (session_id,at,stage,level,message) VALUES (?,?,?,?,?)")
      .run(sessionId, now(), stage, level, redactSecrets(message).slice(0, 2000));
  }

  listActivity(sessionId: string, limit = 300): ActivityEntry[] {
    const rows = this.db
      .prepare("SELECT id,at,stage,level,message FROM activity WHERE session_id = ? ORDER BY id DESC LIMIT ?")
      .all(sessionId, limit) as unknown as ActivityEntry[];
    return rows.reverse().map((r) => ActivityEntry.parse(r));
  }

  /* ------------------------------- usage ------------------------------- */

  recordUsage(sessionId: string, stage: string, u: { inputTokens: number; outputTokens: number; costUsd: number | null; estimated: boolean }): void {
    this.db
      .prepare("INSERT INTO usage (session_id,at,stage,input_tokens,output_tokens,cost_usd,estimated) VALUES (?,?,?,?,?,?,?)")
      .run(sessionId, now(), stage, u.inputTokens, u.outputTokens, u.costUsd, u.estimated ? 1 : 0);
  }

  getUsage(sessionId: string): Usage {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o,
                SUM(cost_usd) AS c, COALESCE(MAX(estimated),0) AS e FROM usage WHERE session_id = ?`,
      )
      .get(sessionId) as { calls: number; i: number; o: number; c: number | null; e: number };
    return Usage.parse({ calls: row.calls, inputTokens: row.i, outputTokens: row.o, costUsd: row.c, estimated: row.e === 1 });
  }
}

let singleton: Store | null = null;

/** Process-wide store (survives Next dev-server module reloads via globalThis). */
export function getStore(): Store {
  const g = globalThis as unknown as { __readyspecStore?: Store };
  if (!g.__readyspecStore) g.__readyspecStore = new Store(openDatabase(defaultDbPath()));
  singleton = g.__readyspecStore;
  return singleton;
}

export function createMemoryStore(): Store {
  return new Store(openDatabase(":memory:"));
}
