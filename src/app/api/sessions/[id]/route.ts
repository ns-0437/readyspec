import { NextResponse } from "next/server";
import { getService } from "@/server/workflow/service";
import { NotFoundError } from "@/server/workflow/errors";
import { withHandler, type Ctx } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (_req: Request, ctx: Ctx) =>
  withHandler(async () => {
    const { id } = await ctx.params;
    const detail = getService().getDetail(id);
    if (!detail) throw new NotFoundError();
    return NextResponse.json(detail);
  });

export const DELETE = (_req: Request, ctx: Ctx) =>
  withHandler(async () => {
    const { id } = await ctx.params;
    getService().delete(id);
    return NextResponse.json({ ok: true });
  });
