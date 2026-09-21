import type { InspectionResult } from "@/shared/schemas";
import { isEntryPoint, isInstructionFile, isManifest, isTestFile } from "./filters";
import type { Snapshot } from "./types";

/** Stage 1: describe the repository from the snapshot alone. No model, no network. */
export function inspectSnapshot(snapshot: Snapshot): InspectionResult {
  const files = [...snapshot.files.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
  const languageCounts = new Map<string, number>();
  let totalBytes = 0;
  for (const f of files) {
    languageCounts.set(f.language, (languageCounts.get(f.language) ?? 0) + 1);
    totalBytes += f.size;
  }
  const paths = files.map((f) => f.path);
  return {
    snapshotId: snapshot.id,
    commit: snapshot.commit,
    fileCount: files.length,
    totalBytes,
    languages: [...languageCounts.entries()]
      .map(([language, n]) => ({ language, files: n }))
      .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language)),
    manifests: paths.filter(isManifest),
    entryPoints: paths.filter((p) => isEntryPoint(p) && !isTestFile(p)),
    testFiles: paths.filter(isTestFile),
    instructionFiles: paths.filter(isInstructionFile),
    excluded: snapshot.excluded.slice(0, 200),
    truncated: snapshot.truncated,
  };
}
