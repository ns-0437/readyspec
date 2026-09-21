import os from "node:os";
import { beforeAll, describe, expect, it } from "vitest";
import { SessionDetail } from "@/shared/schemas";
import { DEMO_REPO, DEMO_TICKET } from "./helpers";

/* Exercises the real route handlers (thin layer over the service) with an in-memory database. */

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const mods: Record<string, Record<string, Handler>> = {};

const call = async (mod: string, method: string, id: string | null, body?: unknown, url = "http://localhost/api"): Promise<Response> => {
  const req = new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  return mods[mod]![method]!(req, { params: Promise.resolve({ id: id ?? "" }) });
};
const wait = async (id: string) => {
  const { getService } = await import("@/server/workflow/service");
  await getService().waitForIdle(id);
};

beforeAll(async () => {
  process.env.READYSPEC_DB = ":memory:";
  delete process.env.ANTHROPIC_API_KEY;
  process.env.READYSPEC_PROVIDER = "fixture";
  mods.sessions = (await import("@/app/api/sessions/route")) as never;
  mods.session = (await import("@/app/api/sessions/[id]/route")) as never;
  mods.analyze = (await import("@/app/api/sessions/[id]/analyze/route")) as never;
  mods.answers = (await import("@/app/api/sessions/[id]/answers/route")) as never;
  mods.brief = (await import("@/app/api/sessions/[id]/brief/route")) as never;
  mods.approve = (await import("@/app/api/sessions/[id]/approve/route")) as never;
  mods.export = (await import("@/app/api/sessions/[id]/export/route")) as never;
  mods.cancel = (await import("@/app/api/sessions/[id]/cancel/route")) as never;
  mods.repos = (await import("@/app/api/repositories/route")) as never;
});

describe("API", () => {
  it("lists the demo repository and reports the fixture provider", async () => {
    const res = await mods.repos!.GET!(new Request("http://localhost/api/repositories"), { params: Promise.resolve({ id: "" }) });
    const json = (await res.json()) as { repositories: { label: string; isDemo: boolean }[]; provider: { kind: string } };
    expect(json.provider.kind).toBe("fixture");
    expect(json.repositories.find((r) => r.label === "demo-repository")?.isDemo).toBe(true);
  });

  it("validates request bodies with useful errors", async () => {
    let res = await call("sessions", "POST", null, { repoPath: DEMO_REPO, ticket: "short" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/too short/i);
    res = await call("sessions", "POST", null, "{not json");
    expect(res.status).toBe(400);
    res = await call("sessions", "POST", null, { repoPath: "relative", ticket: DEMO_TICKET });
    expect(res.status).toBe(400);
    res = await call("sessions", "POST", null, { repoPath: os.tmpdir(), ticket: DEMO_TICKET });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/allowed roots/);
  });

  it("returns 404 and 409 with clear messages", async () => {
    expect((await call("session", "GET", "s_nope")).status).toBe(404);
    const created = await call("sessions", "POST", null, { repoPath: DEMO_REPO, ticket: DEMO_TICKET });
    const { session } = (await created.json()) as { session: { id: string } };
    expect((await call("brief", "POST", session.id)).status).toBe(409); // no brief before answers
    expect((await call("analyze", "POST", session.id, { consent: false })).status).toBe(422); // consent required
    expect((await call("export", "GET", session.id)).status).toBe(422); // nothing to export yet
  });

  it("runs the full workflow over HTTP handlers and exports Markdown and JSON", async () => {
    const created = await call("sessions", "POST", null, { repoPath: DEMO_REPO, ticket: DEMO_TICKET });
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as { session: { id: string } };
    const id = session.id;

    expect((await call("analyze", "POST", id, { consent: true })).status).toBe(202);
    await wait(id);
    let detail = SessionDetail.parse(await (await call("session", "GET", id)).json());
    expect(detail.session.status).toBe("awaiting_answers");

    const qs = detail.rounds[0]!.questions;
    const answers = qs.map((q) => ({ questionId: q.id, source: "suggestion_accepted", answer: q.suggestedAnswers[0]!.text }));
    expect((await call("answers", "POST", id, { answers })).status).toBe(200);
    expect((await call("brief", "POST", id)).status).toBe(202);
    await wait(id);
    detail = SessionDetail.parse(await (await call("session", "GET", id)).json());
    expect(detail.session.status).toBe("review");
    expect(detail.brief!.openQuestions).toEqual([]);

    // Approval needs the reviewer name; a schema violation is a 400.
    expect((await call("approve", "POST", id, { reviewer: "" })).status).toBe(400);
    const approved = await call("approve", "POST", id, { reviewer: "API Tester", note: "ok" });
    expect(approved.status).toBe(200);
    expect(SessionDetail.parse(await approved.json()).brief!.status).toBe("approved");

    const md = await call("export", "GET", id, undefined, `http://localhost/api/x?format=md`);
    expect(md.headers.get("content-type")).toMatch(/markdown/);
    const text = await md.text();
    expect(text).toMatch(/FIXTURE OUTPUT/);
    expect(text).toMatch(/DEMONSTRATION DATA/);
    expect(text).toMatch(/approved by API Tester/);

    const js = await call("export", "GET", id, undefined, `http://localhost/api/x?format=json`);
    const parsed = JSON.parse(await js.text()) as { format: string; isFixtureOutput: boolean; verification: { passed: boolean } };
    expect(parsed).toMatchObject({ format: "readyspec.brief/v1", isFixtureOutput: true });
    expect(parsed.verification.passed).toBe(true);

    expect((await call("export", "GET", id, undefined, `http://localhost/api/x?format=pdf`)).status).toBe(422);
  });

  it("returns 400 for an edit whose body fails the brief schema", async () => {
    const created = await call("sessions", "POST", null, { repoPath: DEMO_REPO, ticket: DEMO_TICKET });
    const { session } = (await created.json()) as { session: { id: string } };
    const res = await call("brief", "PUT", session.id, { brief: { title: "x" }, baseRevision: 1 });
    expect(res.status).toBe(400);
  });

  it("does not leak internals on unexpected errors", async () => {
    const res = await call("session", "DELETE", "s_nope");
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toMatch(/stack|node_modules/);
  });
});
