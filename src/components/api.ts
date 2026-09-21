import { z } from "zod";
import { SessionDetail, SessionSummary, type AnswerInput, type BriefContent, ProviderInfo, SessionLimits } from "@/shared/schemas";

/** Thin typed client. Every response is validated with the same Zod schemas the server uses. */

async function request<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as { error?: string }).error ?? `Request failed (${res.status})`;
    const issues = (json as { issues?: { path: string; message: string }[] }).issues;
    throw new Error(issues?.length ? `${msg}: ${issues.map((i) => `${i.path} ${i.message}`).join("; ")}` : msg);
  }
  return schema.parse(json);
}

const Accepted = z.object({ accepted: z.boolean() });
const RepoList = z.object({
  roots: z.array(z.string()),
  repositories: z.array(z.object({ path: z.string(), label: z.string(), isDemo: z.boolean() })),
  provider: ProviderInfo,
  limits: SessionLimits,
});

export const api = {
  repositories: () => request("/api/repositories", RepoList),
  sessions: () => request("/api/sessions", z.object({ sessions: z.array(SessionSummary) })),
  create: (repoPath: string, ticket: string) => request("/api/sessions", z.object({ session: SessionSummary }), { method: "POST", body: JSON.stringify({ repoPath, ticket }) }),
  detail: (id: string) => request(`/api/sessions/${id}`, SessionDetail),
  remove: (id: string) => request(`/api/sessions/${id}`, z.object({ ok: z.boolean() }), { method: "DELETE" }),
  analyze: (id: string) => request(`/api/sessions/${id}/analyze`, Accepted, { method: "POST", body: JSON.stringify({ consent: true }) }),
  answers: (id: string, answers: AnswerInput[]) => request(`/api/sessions/${id}/answers`, SessionDetail, { method: "POST", body: JSON.stringify({ answers }) }),
  generateBrief: (id: string) => request(`/api/sessions/${id}/brief`, Accepted, { method: "POST" }),
  saveBrief: (id: string, brief: BriefContent, baseRevision: number) => request(`/api/sessions/${id}/brief`, SessionDetail, { method: "PUT", body: JSON.stringify({ brief, baseRevision }) }),
  approve: (id: string, reviewer: string, note: string, acknowledgeOpenItems: boolean) =>
    request(`/api/sessions/${id}/approve`, SessionDetail, { method: "POST", body: JSON.stringify({ reviewer, note, acknowledgeOpenItems }) }),
  followUp: (id: string) => request(`/api/sessions/${id}/followup`, Accepted, { method: "POST" }),
  declineFollowUp: (id: string) => request(`/api/sessions/${id}/followup/decline`, Accepted, { method: "POST" }),
  cancel: (id: string) => request(`/api/sessions/${id}/cancel`, z.object({ cancelled: z.boolean() }), { method: "POST" }),
  resume: (id: string) => request(`/api/sessions/${id}/resume`, Accepted, { method: "POST" }),
  exportUrl: (id: string, format: "md" | "json") => `/api/sessions/${id}/export?format=${format}`,
};
