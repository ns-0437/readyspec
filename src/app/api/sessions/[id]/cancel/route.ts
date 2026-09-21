import { NextResponse } from "next/server";
import { getService } from "@/server/workflow/service";
import { withHandler, type Ctx } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (_req: Request, ctx: Ctx) =>
  withHandler(async () => {
    const { id } = await ctx.params;
    return NextResponse.json({ cancelled: getService().cancel(id) });
  });
