import type { ExcludedFile } from "@/shared/schemas";

export interface SnapshotFile {
  /** POSIX-style path relative to the repository root. */
  path: string;
  size: number;
  sha256: string;
  content: string;
  language: string;
}

/** An immutable, content-addressed copy of the readable files of a repository. */
export interface Snapshot {
  /** sha256 over the sorted (path, file hash) list. */
  id: string;
  /** Absolute repository root at capture time (informational; never read again for analysis). */
  root: string;
  /** Commit sha read from .git metadata without running git; null if not a git checkout. */
  commit: string | null;
  files: Map<string, SnapshotFile>;
  excluded: ExcludedFile[];
  /** True when a file-count or byte cap stopped the walk early. */
  truncated: boolean;
  capturedAt: string;
}

export interface SnapshotLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
}

export const DEFAULT_SNAPSHOT_LIMITS: SnapshotLimits = {
  maxFiles: 1500,
  maxFileBytes: 200 * 1024,
  maxTotalBytes: 12 * 1024 * 1024,
  maxDepth: 12,
};
