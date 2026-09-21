import fs from "node:fs";
import path from "node:path";
import { EvalCase } from "./schema";

export const CASES_DIR = path.resolve(__dirname, "..", "cases");

/** Load and validate every benchmark case, sorted by id. */
export function loadCases(): EvalCase[] {
  return fs
    .readdirSync(CASES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => EvalCase.parse(JSON.parse(fs.readFileSync(path.join(CASES_DIR, f), "utf8"))));
}
