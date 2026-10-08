import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { DemoData } from "../demo/src/types";

const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist-demo");
// Fixed public-fixture allowlist. Never copy repository trees, .env files, SQLite, or server bundles.
const excerpts = [
  { id: "delivery", path: "src/notifications/dispatcher.ts", startLine: 12, endLine: 17, label: "Security bypasses category preferences" },
  { id: "preferences", path: "src/users/preferences.ts", startLine: 5, endLine: 11, label: "Current preferences have no pause window" },
  { id: "channels", path: "src/notifications/dispatcher.ts", startLine: 19, endLine: 21, label: "Enabled channels control delivery destinations" },
  { id: "tests", path: "tests/dispatcher.test.ts", startLine: 13, endLine: 24, label: "Existing category and security test cases" },
];
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const data: DemoData = {
  version: 1, kind: "scripted-demo", commit,
  ticket: "Let users pause notifications while they are away.",
  evidence: excerpts.map((excerpt) => {
    const lines = fs.readFileSync(path.join(root, "fixtures/demo-repository", excerpt.path), "utf8").replace(/\r\n/g, "\n").split("\n");
    if (lines.length < excerpt.endLine) throw new Error(`Missing fixture lines: ${excerpt.path}`);
    const text = lines.slice(excerpt.startLine - 1, excerpt.endLine).join("\n");
    return { ...excerpt, text, sha256: createHash("sha256").update(text).digest("hex"), sourceUrl: `https://github.com/ns-0437/readyspec/blob/${commit}/fixtures/demo-repository/${excerpt.path}#L${excerpt.startLine}-L${excerpt.endLine}` };
  }),
};
if (path.dirname(output) !== root || path.basename(output) !== "dist-demo") throw new Error("Unsafe output directory");
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(output, "assets"), { recursive: true });
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "demo/tsconfig.json"], { cwd: root, stdio: "inherit" });
for (const name of ["index.html", "styles.css", "favicon.svg"]) fs.copyFileSync(path.join(root, "demo/public", name), path.join(output, name));
fs.writeFileSync(path.join(output, "assets/evidence.json"), JSON.stringify(data, null, 2));
fs.writeFileSync(path.join(output, ".nojekyll"), "");
console.log(`Static demo built: ${output}. ${data.evidence.length} public fixture excerpts; no server or provider code.`);
