import { parseArgs } from "node:util";
import type { SystemName } from "./score";

const VALUE_OPTIONS = [
  "provider", "set", "systems", "cases", "repeat", "profile", "output-allowance", "evidence-max-chars",
  "safety-margin", "provider-token-limit", "max-calls", "max-input-tokens", "max-output-tokens", "max-cost-usd",
] as const;
const SYSTEMS: Record<string, SystemName> = {
  checklist: "checklist", single: "single_prompt", single_prompt: "single_prompt", staged: "staged",
  single_alphabetical: "single_prompt_alphabetical", single_prompt_alphabetical: "single_prompt_alphabetical",
};

/** Strict parsing happens before provider creation, retrieval, or writing results. */
export function parseEvalArgs(args: string[]) {
  const { values, tokens } = parseArgs({
    args, strict: true, allowPositionals: false, tokens: true,
    options: {
      ...Object.fromEntries(VALUE_OPTIONS.map((name) => [name, { type: "string" as const }])),
      pilot: { type: "boolean" }, "dry-run": { type: "boolean" },
    },
  });
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name)) throw new Error(`Duplicate option --${token.name}`);
    seen.add(token.name);
  }
  const get = (name: string): string | undefined => {
    const raw = values[name];
    if (typeof raw !== "string") return undefined;
    if (!raw.trim() || raw.startsWith("--")) throw new Error(`--${name} requires a value`);
    return raw.trim();
  };
  for (const name of VALUE_OPTIONS) get(name);
  const positiveInt = (name: string, fallback?: number) => {
    const raw = get(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`--${name} must be a positive safe integer`);
    return value;
  };
  const pilot = values.pilot === true;
  const repeat = positiveInt("repeat", 1)!;
  if (pilot && (get("cases") || get("systems") || get("set") || repeat !== 1)) {
    throw new Error("--pilot fixes the development cases, systems, and one repetition; omit --cases, --systems, --set, and use --repeat 1");
  }
  const set = get("set") ?? "dev";
  if (!["dev", "heldout", "heldout-v2", "all"].includes(set)) throw new Error("--set must be dev, heldout, heldout-v2 or all");
  const list = (raw: string, name: string) => {
    const parts = raw.split(",").map((s) => s.trim());
    if (parts.some((s) => !s)) throw new Error(`--${name} contains an empty entry`);
    return parts;
  };
  const systems: SystemName[] = pilot ? ["single_prompt", "staged"] : list(get("systems") ?? "checklist,single,staged", "systems").map((name) => {
    const system = Object.hasOwn(SYSTEMS, name) ? SYSTEMS[name] : undefined;
    if (!system) throw new Error(`Unknown system "${name}"; use checklist, single, staged, or single_alphabetical`);
    return system;
  });
  if (new Set(systems).size !== systems.length) throw new Error("--systems contains duplicate systems or aliases");
  const casesArg = get("cases");
  const only = casesArg ? list(casesArg, "cases") : [];
  if (new Set(only).size !== only.length) throw new Error("--cases contains duplicate case IDs");
  return { get, pilot, dryRun: values["dry-run"] === true, repeat, set, systems, only, providerTokenLimit: positiveInt("provider-token-limit") };
}

export function validateSelectedCases(requested: string[], available: { id: string }[]): void {
  const ids = new Set(available.map((c) => c.id));
  const missing = requested.filter((id) => !ids.has(id));
  if (missing.length) throw new Error(`Case IDs not in the selected set: ${missing.join(", ")}`);
  if (!available.length) throw new Error("The selected set contains no cases");
}
