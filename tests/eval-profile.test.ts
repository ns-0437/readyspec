import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderEvidence } from "@/server/llm/prompts";
import { clarifyPrompt, briefPrompt, analyzePrompt } from "@/server/llm/prompts";
import { ProviderError, type LlmProvider, type LlmRequest } from "@/server/llm/provider";
import { investigate } from "@/server/workflow/investigate";
import { STAGE_MAX_OUTPUT } from "@/server/workflow/stages";
import { loadCases } from "../evals/runners/cases";
import { planPilot, renderPlan } from "../evals/runners/pilot";
import { PROFILES, profileProblems, resolveProfile, retrievalFor } from "../evals/runners/profile";
import { runSinglePrompt, runStaged, snapshotFor } from "../evals/runners/systems";

const demo = loadCases().find((c) => c.id === "demo-01-pause-notifications")!;

describe("evaluation profiles", () => {
  it("keeps the default profile identical to production allowances and adds the compact candidates", () => {
    expect(resolveProfile(undefined).outputs).toEqual(STAGE_MAX_OUTPUT);
    expect(resolveProfile("default").evidenceMaxChars).toBeNull();
    expect(resolveProfile("compact").outputs).toEqual({ analyze: 1500, clarify: 1000, brief: 2500, single_prompt: 2500 });
    expect(PROFILES.compact!.outputs.single_prompt).toBe(PROFILES.compact!.outputs.brief); // equal for the comparison
    expect(PROFILES.default!.outputs).toEqual({ analyze: 6000, clarify: 4000, brief: 10000, single_prompt: 6000 });
  });

  it("applies and names overrides, and rejects invalid configuration", () => {
    const p = resolveProfile("compact", { outputs: "analyze=1200,brief=2000,single_prompt=2000", evidenceMaxChars: "4300" });
    expect(p).toMatchObject({ name: "compact+overrides", outputs: { analyze: 1200, clarify: 1000, brief: 2000, single_prompt: 2000 }, evidenceMaxChars: 4300 });
    expect(() => resolveProfile("tiny")).toThrow(/Unknown profile/);
    expect(() => resolveProfile("compact", { outputs: "summarize=100" })).toThrow(/stage=tokens/);
    expect(() => resolveProfile("compact", { outputs: "analyze=0" })).toThrow(/positive integer/);
    expect(() => resolveProfile("compact", { outputs: "analyze=-5" })).toThrow(/positive integer/);
    expect(() => resolveProfile("compact", { outputs: "analyze=1.5" })).toThrow(/positive integer/);
    expect(() => resolveProfile("compact", { outputs: "analyze=999999999" })).toThrow(/positive integer/);
    expect(() => resolveProfile("compact", { evidenceMaxChars: "abc" })).toThrow(/positive integer/);
  });

  it("flags an unfair comparison: single-prompt and brief allowances must match when both systems run", () => {
    const uneven = resolveProfile("compact", { outputs: "single_prompt=2000" });
    expect(profileProblems(uneven, ["single_prompt", "staged"])).toHaveLength(1);
    expect(profileProblems(uneven, ["staged"])).toEqual([]);
    expect(profileProblems(PROFILES.compact!, ["single_prompt", "staged"])).toEqual([]);
    expect(profileProblems(PROFILES.compact!, ["single_prompt_alphabetical"])).toHaveLength(1); // that baseline ignores profiles
  });

  it("sends both systems the same capped evidence and the profile's output allowances", async () => {
    const profile = resolveProfile("compact", { evidenceMaxChars: "4300" });
    const calls: LlmRequest[] = [];
    const provider: LlmProvider = { info: { kind: "groq", label: "capture", model: "m" }, leavesMachine: false, async complete(req) { calls.push(req); throw new ProviderError("stop", { retryable: false }); } };
    await runSinglePrompt(demo, provider, undefined, profile);
    await runStaged(demo, provider, undefined, profile);
    const [single, analyze] = calls;
    const kept = investigate(snapshotFor(demo.repo), demo.ticket, retrievalFor(profile)).evidence;
    expect(kept.length).toBeLessThan(investigate(snapshotFor(demo.repo), demo.ticket).evidence.length); // the cap really reduced it
    expect(single!.user).toContain(renderEvidence(kept));
    expect(analyze!.user).toContain(renderEvidence(kept));
    expect(single!.maxOutputTokens).toBe(2500);
    expect(analyze!.maxOutputTokens).toBe(1500);
  });
});

describe("feasibility plan", () => {
  const sel = [{ c: demo, role: "selected" }];
  const systems = ["single_prompt", "staged"] as const;

  it("reports schema overhead, margin, reservations, retry exposure and the budget needed", () => {
    const plan = planPilot({ cases: sel, systems: [...systems], prices: null, providerTokenLimit: 8000, profile: PROFILES.compact, safetyMargin: 0.1 });
    expect(plan.callsBeforeRetries).toBe(4);
    expect(plan.maxAttempts).toBe(12);
    expect(plan.rows.every((r) => r.schemaTokens > 0 && r.systemTokens > 0)).toBe(true);
    expect(plan.outputMaxBeforeRetries).toBe(2500 + 1500 + 1000 + 2500);
    expect(plan.worstCaseLimits).toMatchObject({ maxCalls: 12, maxOutputTokens: 3 * 7500 });
    expect(plan.noRetryLimits.maxInputTokens).toBeLessThan(plan.worstCaseLimits.maxInputTokens);
    const text = renderPlan(plan, { providerLabel: "mock", systems: [...systems], providerTokenLimit: 8000, runLimitsSet: false });
    expect(text).toContain("FEASIBILITY CHECK");
    expect(text).toContain("NOT exact tokenization");
    expect(text).toContain("credentials being present is not authorization");
    expect(plan.oversize.map((o) => o.stage)).toEqual(["brief"]); // the one stage that cannot fit 8000 with the full evidence
  });

  it("shows exactly which excerpts a shared evidence cap drops and whether required files survive", () => {
    const capped = planPilot({ cases: sel, systems: [...systems], prices: null, profile: resolveProfile("compact", { evidenceMaxChars: "4000" }) });
    const e = capped.evidence[0]!;
    expect(e.excluded.length).toBeGreaterThan(0);
    expect(e.keptChars).toBeLessThan(e.fullChars);
    expect(e.requiredRetained).toBe(false); // too small a cap drops decideDelivery: reported, not hidden
    const ok = planPilot({ cases: sel, systems: [...systems], prices: null, profile: resolveProfile("compact", { evidenceMaxChars: "4300" }) });
    expect(ok.evidence[0]!.requiredRetained).toBe(true);
    expect(planPilot({ cases: sel, systems: [...systems], prices: null }).evidence[0]!.excluded).toEqual([]); // default budget excludes nothing
  });
});

describe("prompt trimming", () => {
  it("does not resend evidenceNotes to the clarify and brief stages, but still asks for them in analyze", () => {
    const inv = investigate(snapshotFor(demo.repo), demo.ticket);
    const analysis = { observations: [], contradictions: [], missingDecisions: [], insufficientEvidence: [], evidenceNotes: { [inv.evidence[0]!.id]: "UNIQUE-NOTE-TEXT" } };
    expect(clarifyPrompt({ ticket: "t", analysis, evidence: inv.evidence, decisions: [], priorQuestions: [], round: 1 })).not.toContain("UNIQUE-NOTE-TEXT");
    expect(briefPrompt({ ticket: "t", analysis, evidence: inv.evidence, decisions: [], rounds: [], inspection: inv.inspection })).not.toContain("UNIQUE-NOTE-TEXT");
    expect(clarifyPrompt({ ticket: "t", analysis, evidence: inv.evidence, decisions: [], priorQuestions: [], round: 1 })).toContain('"observations":[]'); // the rest of the analysis is still sent
    expect(analyzePrompt({ ticket: "t", evidence: inv.evidence, inspection: inv.inspection })).toContain("evidenceNotes");
  });
});

describe("CLI --dry-run", () => {
  it("makes zero provider calls, creates no run directory and prints no key", async () => {
    let requests = 0;
    const server = http.createServer((_req, res) => { requests++; res.writeHead(500); res.end("{}"); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const runsDir = path.resolve("evals", "results", "runs");
    const runsBefore = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).length : 0;
    const KEY = "dummy-not-a-real-key-123456";
    try {
      const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(process.execPath, [path.resolve("node_modules", "tsx", "dist", "cli.mjs"), "evals/runners/run.ts", "--dry-run", "--cases", demo.id, "--systems", "single,staged", "--profile", "compact", "--provider", "groq", "--provider-token-limit", "8000"], {
          env: { ...process.env, GROQ_API_KEY: KEY, GROQ_BASE_URL: base },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d));
        child.stderr.on("data", (d) => (stderr += d));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      });
      expect(stderr).not.toContain("Error");
      expect(code).toBe(0);
      expect(stdout).toContain("DRY RUN: no provider calls were made");
      expect(stdout).toContain("FEASIBILITY CHECK");
      expect(stdout).not.toContain(KEY);
      expect(requests).toBe(0); // the provider endpoint never saw a request
      expect(fs.existsSync(runsDir) ? fs.readdirSync(runsDir).length : 0).toBe(runsBefore);
      // sanity: the counter does work
      await fetch(base).catch(() => undefined);
      expect(requests).toBe(1);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 90_000);
});
