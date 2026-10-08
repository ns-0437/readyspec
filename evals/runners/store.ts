/**
 * Durable benchmark artifacts. Each run gets a unique directory; every case/system/repetition is
 * written the moment it finishes (failures included), so an interrupted run keeps what completed.
 * Raw results and the human scoring sheet are write-once: nothing here overwrites them.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { EvalCase } from "./schema";
import type { CaseScore, SystemName, SystemOutput } from "./score";

export interface SavedResult {
  caseId: string;
  system: SystemName;
  repetition: number;
  provider: { kind: string; label: string; model: string | null };
  savedAt: string;
  output: SystemOutput;
  /** "completed": scored like any result (including model failures). "budget_exhausted": the run-wide budget stopped this case mid-way; its output is partial and it is NOT scored or aggregated. */
  status?: "completed" | "budget_exhausted";
  score: CaseScore | null;
}

/** Write via a temp file and rename, so a crash never leaves a half-written file under the final name. */
export function atomicWrite(file: string, data: string): void {
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** Create a file that must not exist yet ("wx"); throws if it does. Used for raw results and scoring sheets. */
export function writeOnce(file: string, data: string): void {
  fs.writeFileSync(file, data, { flag: "wx" });
}

/** Creates a fresh, unique run directory (never reuses one). */
export function createRunDir(baseDir: string, label: string): string {
  fs.mkdirSync(baseDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (let i = 0; i < 20; i++) {
    const dir = path.join(baseDir, `${label}-${stamp}-${crypto.randomBytes(3).toString("hex")}`);
    try {
      fs.mkdirSync(dir); // non-recursive: fails with EEXIST rather than reusing a directory
      return dir;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  throw new Error("could not create a unique run directory");
}

const resultFile = (dir: string, repetition: number, caseId: string, system: SystemName) => path.join(dir, "results", `rep${repetition}`, `${caseId}__${system}.json`);

export function saveResult(dir: string, r: SavedResult): string {
  const file = resultFile(dir, r.repetition, r.caseId, r.system);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeOnce(file, JSON.stringify(r, null, 2)); // raw results are immutable; a duplicate key is a bug, so fail loudly
  return path.relative(dir, file).split(path.sep).join("/");
}

export function readSavedResults(dir: string): SavedResult[] {
  const root = path.join(dir, "results");
  if (!fs.existsSync(root)) return [];
  const out: SavedResult[] = [];
  for (const rep of fs.readdirSync(root).sort()) {
    for (const f of fs.readdirSync(path.join(root, rep)).filter((x) => x.endsWith(".json")).sort()) {
      out.push(JSON.parse(fs.readFileSync(path.join(root, rep, f), "utf8")) as SavedResult);
    }
  }
  return out;
}

/** One row per case x system x repetition; `output_file` ties each row to its saved raw result. */
export function humanSheet(cases: EvalCase[], systems: SystemName[], repeat: number): string {
  const head = ["repetition", "case_id", "system", "output_file", "held_out", "brief_usable_as_is(0-2)", "critical_gaps_missed(count)", "wrong_or_unsupported_claims(count)", "unnecessary_questions(count)", "minutes_to_make_usable", "reviewer", "notes"];
  const rows = [head.join(",")];
  for (let rep = 1; rep <= repeat; rep++) {
    for (const c of cases) {
      for (const s of systems) {
        const file = `results/rep${rep}/${c.id}__${s}.json`;
        rows.push([String(rep), c.id, s, file, c.heldOut ? "yes" : "no", "", "", "", "", "", "", ""].join(","));
      }
    }
  }
  return rows.join("\n") + "\n";
}
