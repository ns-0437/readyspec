import fs from "node:fs";
import path from "node:path";

export class RepositoryAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryAccessError";
  }
}

/** True when `candidate` is `root` or lives beneath it (both must already be absolute + real). */
export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve the repository root: must exist, be a directory, and not be a filesystem root.
 * Returns the *real* path (symlinks in the root itself are resolved once, here).
 */
export function resolveRepositoryRoot(input: string): string {
  if (!path.isAbsolute(input)) throw new RepositoryAccessError("Repository path must be absolute");
  let real: string;
  try {
    real = fs.realpathSync.native(input);
  } catch {
    throw new RepositoryAccessError("Repository path does not exist");
  }
  if (!fs.statSync(real).isDirectory()) throw new RepositoryAccessError("Repository path is not a directory");
  if (path.parse(real).root === real) throw new RepositoryAccessError("Refusing to use a filesystem root as a repository");
  return real;
}

/**
 * Resolve `relative` beneath `root`, rejecting traversal (`..`), absolute paths and NUL bytes.
 * Does not follow symlinks; callers must lstat before reading.
 */
export function resolveInside(root: string, relative: string): string {
  if (relative.includes("\0")) throw new RepositoryAccessError("Invalid path");
  if (path.isAbsolute(relative)) throw new RepositoryAccessError("Absolute paths are not allowed");
  const full = path.resolve(root, relative);
  if (!isInside(root, full)) throw new RepositoryAccessError("Path escapes the repository");
  return full;
}

/** Comma-separated allowlist of directories a session may select (env READYSPEC_ALLOWED_ROOTS). */
export function allowedRoots(extra: string[] = []): string[] {
  const env = (process.env.READYSPEC_ALLOWED_ROOTS ?? "")
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...env, ...extra].map((p) => path.resolve(p)))];
}

/** A repo may be selected only if it sits inside one of the allowed roots. */
export function assertRepositoryAllowed(repoRealPath: string, roots: string[]): void {
  for (const r of roots) {
    let realRoot: string;
    try {
      realRoot = fs.realpathSync.native(r);
    } catch {
      continue;
    }
    if (isInside(realRoot, repoRealPath)) return;
  }
  throw new RepositoryAccessError(
    "Repository is outside the allowed roots. Add its parent directory to READYSPEC_ALLOWED_ROOTS.",
  );
}
