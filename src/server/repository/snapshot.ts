import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ExcludedFile } from "@/shared/schemas";
import { excludeByContent, excludeByName, EXCLUDED_DIRS, languageOf } from "./filters";
import { isInside, RepositoryAccessError, resolveRepositoryRoot } from "./safe-fs";
import { DEFAULT_SNAPSHOT_LIMITS, type Snapshot, type SnapshotFile, type SnapshotLimits } from "./types";

const MAX_EXCLUDED_RECORDED = 400;

export function sha256(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** Read the checked-out commit from .git metadata. Never runs git. */
export function readCommit(root: string): string | null {
  try {
    const gitDir = path.join(root, ".git");
    if (!fs.lstatSync(gitDir).isDirectory()) return null;
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/i.test(head)) return head;
    const m = /^ref:\s*(.+)$/.exec(head);
    if (!m?.[1]) return null;
    const ref = m[1];
    const loose = path.join(gitDir, ref);
    if (isInside(gitDir, loose) && fs.existsSync(loose)) return fs.readFileSync(loose, "utf8").trim() || null;
    const packed = path.join(gitDir, "packed-refs");
    if (fs.existsSync(packed)) {
      for (const line of fs.readFileSync(packed, "utf8").split("\n")) {
        if (line.endsWith(` ${ref}`)) return line.split(" ")[0] ?? null;
      }
    }
  } catch {
    /* not a git checkout, or unreadable: fine */
  }
  return null;
}

/**
 * Capture a read-only, content-addressed snapshot of a repository.
 * - never follows symlinks/junctions (they are recorded as excluded)
 * - never opens secret, binary, generated, minified, oversized or secret-bearing files
 * - never executes anything from the repository
 */
export function createSnapshot(repoPath: string, limits: SnapshotLimits = DEFAULT_SNAPSHOT_LIMITS): Snapshot {
  const root = resolveRepositoryRoot(repoPath);
  const files = new Map<string, SnapshotFile>();
  const excluded: ExcludedFile[] = [];
  let truncated = false;
  let totalBytes = 0;

  const exclude = (rel: string, reason: string) => {
    if (excluded.length < MAX_EXCLUDED_RECORDED) excluded.push({ path: rel, reason });
  };

  const walk = (dirAbs: string, dirRel: string, depth: number): void => {
    if (truncated) return;
    if (depth > limits.maxDepth) {
      exclude(dirRel || ".", "too-deep");
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      exclude(dirRel || ".", "unreadable");
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (truncated) return;
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      const abs = path.join(dirAbs, entry.name);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(abs);
      } catch {
        exclude(rel, "unreadable");
        continue;
      }
      if (st.isSymbolicLink()) {
        exclude(rel, "symlink");
        continue;
      }
      if (st.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) {
          exclude(rel + "/", "excluded-directory");
          continue;
        }
        walk(abs, rel, depth + 1);
        continue;
      }
      if (!st.isFile()) {
        exclude(rel, "not-a-regular-file");
        continue;
      }
      const nameReason = excludeByName(rel);
      if (nameReason) {
        exclude(rel, nameReason);
        continue;
      }
      if (st.size > limits.maxFileBytes) {
        exclude(rel, "oversized");
        continue;
      }
      if (files.size >= limits.maxFiles || totalBytes + st.size > limits.maxTotalBytes) {
        truncated = true;
        exclude(rel, "snapshot-limit-reached");
        return;
      }
      let buf: Buffer;
      try {
        // Defence in depth: the real path must still be inside the root at read time.
        if (!isInside(root, fs.realpathSync.native(abs))) {
          exclude(rel, "escapes-repository");
          continue;
        }
        buf = fs.readFileSync(abs);
      } catch {
        exclude(rel, "unreadable");
        continue;
      }
      const text = buf.toString("utf8").replace(/\r\n/g, "\n");
      const contentReason = excludeByContent(buf, text);
      if (contentReason) {
        exclude(rel, contentReason);
        continue;
      }
      totalBytes += buf.length;
      files.set(rel, { path: rel, size: buf.length, sha256: sha256(text), content: text, language: languageOf(rel) });
    }
  };

  walk(root, "", 0);
  if (files.size === 0) throw new RepositoryAccessError("No readable source files were found in the repository");

  const manifest = [...files.values()]
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((f) => `${f.path}\0${f.sha256}`)
    .join("\n");
  return {
    id: sha256(manifest).slice(0, 32),
    root,
    commit: readCommit(root),
    files,
    excluded,
    truncated,
    capturedAt: new Date().toISOString(),
  };
}
