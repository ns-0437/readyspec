import fs from "node:fs";
import path from "node:path";
import { EXCLUDED_DIRS } from "./filters";

export interface RepoCandidate {
  path: string;
  label: string;
}

const MARKERS = ["package.json", "pyproject.toml", "go.mod", "Cargo.toml", ".git"];

/** Directories under `roots` (up to two levels deep) that look like a project root. Read-only. */
export function discoverRepositories(roots: string[]): RepoCandidate[] {
  const out = new Map<string, RepoCandidate>();
  const looksLikeRepo = (dir: string) => MARKERS.some((m) => fs.existsSync(path.join(dir, m)));
  const subdirs = (dir: string): string[] => {
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.isSymbolicLink() && !EXCLUDED_DIRS.has(d.name))
        .map((d) => path.join(dir, d.name));
    } catch {
      return [];
    }
  };
  for (const root of roots) {
    if (looksLikeRepo(root)) out.set(root, { path: root, label: path.basename(root) });
    for (const child of subdirs(root)) {
      if (looksLikeRepo(child)) out.set(child, { path: child, label: path.basename(child) });
      for (const grand of subdirs(child)) if (looksLikeRepo(grand)) out.set(grand, { path: grand, label: path.basename(grand) });
    }
  }
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label));
}
