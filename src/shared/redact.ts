/**
 * Secret patterns shared by the repository scanner (skip files that contain secrets)
 * and the log/error redactor. Pure, no I/O.
 */
export const SECRET_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "private-key-block", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "anthropic-key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "openai-style-key", regex: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "slack-token", regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: "jwt", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  {
    name: "credential-assignment",
    regex: /\b(?:api[_-]?key|secret|passwd|password|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*["']?[A-Za-z0-9/+_.-]{16,}/i,
  },
];

/** Names of secret patterns found in `text` (empty when clean). */
export function findSecrets(text: string): string[] {
  return SECRET_PATTERNS.filter((p) => p.regex.test(text)).map((p) => p.name);
}

/** Replace anything that looks like a credential before it reaches logs or the database. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const { regex } of SECRET_PATTERNS) {
    out = out.replace(new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g"), "[REDACTED]");
  }
  return out;
}
