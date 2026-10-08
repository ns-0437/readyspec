import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { DemoData } from "../demo/src/types";

const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist-demo");
const expected = [".nojekyll", "assets/app.js", "assets/dom.js", "assets/draft.js", "assets/evidence.json", "assets/model.js", "assets/types.js", "favicon.svg", "index.html", "styles.css"];
function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    assert(!entry.isSymbolicLink(), "Artifact may not contain symlinks");
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : [path.relative(output, full).split(path.sep).join("/")];
  });
}
assert.deepEqual(files(output).sort(), expected.sort(), "Publish only the exact static asset allowlist");
const html = fs.readFileSync(path.join(output, "index.html"), "utf8");
for (const match of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)) {
  assert(fs.existsSync(path.join(output, match[1]!)), `Missing HTML asset: ${match[1]}`);
}
assert(html.includes("Scripted, browser-only demo."), "Required fixture disclosure is missing");
assert(html.includes("connect-src 'self'"), "Demo must not connect to external providers");
for (const file of expected.filter((name) => name.endsWith(".js"))) {
  const js = fs.readFileSync(path.join(output, file), "utf8");
  assert(!/process\.env|ANTHROPIC_API_KEY|GEMINI_API_KEY|GROQ_API_KEY|node:sqlite/.test(js), `Server-only code in ${file}`);
  for (const match of js.matchAll(/from\s+["']([^"']+)["']/g)) {
    assert(match[1]!.startsWith("./"), `Non-local browser import: ${match[1]}`);
    const imported = path.resolve(path.dirname(path.join(output, file)), match[1]!);
    assert(imported.startsWith(output + path.sep) && fs.existsSync(imported), `Missing browser module: ${match[1]}`);
  }
}
const data = JSON.parse(fs.readFileSync(path.join(output, "assets/evidence.json"), "utf8")) as DemoData;
assert.equal(data.kind, "scripted-demo"); assert.equal(data.evidence.length, 4); assert.match(data.commit, /^[a-f0-9]{40}$/);
const allowedPaths = new Set(["src/notifications/dispatcher.ts", "src/users/preferences.ts", "tests/dispatcher.test.ts"]);
for (const e of data.evidence) {
  assert(allowedPaths.has(e.path), `Non-allowlisted source: ${e.path}`);
  const actual = fs.readFileSync(path.join(root, "fixtures/demo-repository", e.path), "utf8").replace(/\r\n/g, "\n").split("\n").slice(e.startLine - 1, e.endLine).join("\n");
  assert.equal(e.text, actual, `Excerpt drifted from source: ${e.id}`);
  assert.equal(e.sha256, createHash("sha256").update(actual).digest("hex"));
  assert.equal(e.sourceUrl, `https://github.com/ns-0437/readyspec/blob/${data.commit}/fixtures/demo-repository/${e.path}#L${e.startLine}-L${e.endLine}`);
}
console.log("Static artifact verified: exact file allowlist, resolvable relative assets, local-only modules, fixture disclosure, source lines and hashes.");
