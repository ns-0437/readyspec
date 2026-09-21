import path from "node:path";
import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";

/**
 * `node:sqlite` is loaded through `process.getBuiltinModule` so Next's bundler never has to
 * resolve it. Requires Node >= 22.13.
 */
function loadSqlite(): typeof import("node:sqlite") {
  const mod = process.getBuiltinModule?.("node:sqlite");
  if (!mod) throw new Error("node:sqlite is unavailable; ReadySpec requires Node >= 22.13");
  return mod as typeof import("node:sqlite");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  repo_label TEXT NOT NULL,
  ticket TEXT NOT NULL,
  provider_json TEXT NOT NULL,
  status TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 1,
  error_json TEXT,
  snapshot_id TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  root TEXT NOT NULL,
  commit_sha TEXT,
  meta_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshot_files (
  snapshot_id TEXT NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  language TEXT NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, path)
);
CREATE TABLE IF NOT EXISTS artifacts (
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 0,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, kind, round)
);
CREATE TABLE IF NOT EXISTS decisions (
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (session_id, question_id)
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  at TEXT NOT NULL,
  stage TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_session ON activity(session_id, id);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  at TEXT NOT NULL,
  stage TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL,
  estimated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage(session_id);
`;

export function openDatabase(file: string): DatabaseSync {
  const { DatabaseSync } = loadSqlite();
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

export function defaultDbPath(): string {
  return process.env.READYSPEC_DB ?? path.join(process.cwd(), "data", "readyspec.db");
}
