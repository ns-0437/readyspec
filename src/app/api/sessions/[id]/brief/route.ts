import { NextResponse } from "next/server";
import { EditBriefBody } from "@/shared/schemas";
import { getService } from "@/server/workflow/service";
import { readBody, withHandler, type Ctx } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generate the brief from recorded decisions (background job; poll the session). */
export const POST = (_req: Request, ctx: Ctx) =>
  withHandler(async () => {
    const { id } = await ctx.params;
    getService().startBrief(id);
    return NextResponse.json({ accepted: true }, { status: 202 });
  });

/** Human edit of the brief. Optimistic concurrency on `baseRevision`; re-verifies deterministically. */
export const PUT = (req: Request, ctx: Ctx) =>
  withHandler(async () => {
    const { id } = await ctx.params;
    const body = await readBody(req, EditBriefBody);
    const service = getService();
    service.editBrief(id, body.brief, body.baseRevision);
    return NextResponse.json(service.getDetail(id));
  });
