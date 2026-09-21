import type { SnapshotFile } from "./types";

export interface CodeSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "enum" | "const" | "heading" | "def";
  startLine: number; // 1-based
  endLine: number; // 1-based, inclusive
}

const TS_DECLS: { kind: CodeSymbol["kind"]; regex: RegExp }[] = [
  { kind: "function", regex: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/ },
  { kind: "class", regex: /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: "interface", regex: /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: "type", regex: /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/ },
  { kind: "enum", regex: /^(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/ },
  { kind: "const", regex: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/ },
];

function stripStringsAndComments(line: string): string {
  return line
    .replace(/\/\/.*$/, "")
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""');
}

/** End line of a brace-delimited declaration starting at `start` (0-based index into lines). */
function braceEnd(lines: string[], start: number): number {
  let depth = 0;
  let seenOpen = false;
  for (let i = start; i < lines.length; i++) {
    const clean = stripStringsAndComments(lines[i] ?? "");
    for (const ch of clean) {
      if (ch === "{" || ch === "(" || ch === "[") {
        depth++;
        if (ch === "{") seenOpen = true;
      } else if (ch === "}" || ch === ")" || ch === "]") depth--;
    }
    if (seenOpen && depth <= 0) return i;
    // Declarations without a brace body (type aliases, simple consts) end at the statement terminator.
    if (!seenOpen && depth <= 0 && /[;,]\s*$/.test(clean.trim())) return i;
    if (!seenOpen && depth <= 0 && i > start && clean.trim() === "") return i - 1;
  }
  return Math.min(lines.length - 1, start + 40);
}

function extractTsLike(lines: string[]): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    let matched = false;
    if (!/^\s/.test(line)) {
      for (const d of TS_DECLS) {
        const m = d.regex.exec(line);
        if (m?.[1]) {
          const end = braceEnd(lines, i);
          out.push({ name: m[1], kind: d.kind, startLine: i + 1, endLine: end + 1 });
          i = Math.max(end + 1, i + 1);
          matched = true;
          break;
        }
      }
    }
    if (!matched) i++;
  }
  return out;
}

function extractPython(lines: string[]): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/.exec(lines[i] ?? "");
    if (!m?.[2]) continue;
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j] ?? "";
      if (l.trim() === "") continue;
      if (/^\S/.test(l)) break;
      end = j;
    }
    out.push({ name: m[2], kind: m[1] === "class" ? "class" : "def", startLine: i + 1, endLine: end + 1 });
  }
  return out;
}

function extractMarkdown(lines: string[]): CodeSymbol[] {
  const heads: { name: string; line: number }[] = [];
  let inFence = false;
  lines.forEach((l, idx) => {
    if (/^```/.test(l)) inFence = !inFence;
    const m = !inFence ? /^#{1,4}\s+(.+?)\s*#*$/.exec(l) : null;
    if (m?.[1]) heads.push({ name: m[1], line: idx + 1 });
  });
  return heads.map((h, i) => ({
    name: h.name,
    kind: "heading" as const,
    startLine: h.line,
    endLine: (heads[i + 1]?.line ?? lines.length + 1) - 1,
  }));
}

export function extractSymbols(file: SnapshotFile): CodeSymbol[] {
  const lines = file.content.split("\n");
  switch (file.language) {
    case "TypeScript":
    case "JavaScript":
    case "Go":
    case "Rust":
    case "Java":
    case "Kotlin":
    case "C#":
      return extractTsLike(lines);
    case "Python":
      return extractPython(lines);
    case "Markdown":
      return extractMarkdown(lines);
    default:
      return [];
  }
}
