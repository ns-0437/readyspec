import { NextResponse } from "next/server";
import { getService } from "@/server/workflow/service";
import { withHandler, type Ctx } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (_req: Request, ctx: Ctx) =>
  withHandler(async () => {
    const { id } = await ctx.params;
    getService().resume(id);
    return NextResponse.json({ accepted: true }, { status: 202 });
  });
