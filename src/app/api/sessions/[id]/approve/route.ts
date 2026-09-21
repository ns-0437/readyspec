import { NextResponse } from "next/server";
import { ApproveBody } from "@/shared/schemas";
import { getService } from "@/server/workflow/service";
import { readBody, withHandler, type Ctx } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request, ctx: Ctx) =>
  withHandler(async () => {
    const { id } = await ctx.params;
    const body = await readBody(req, ApproveBody);
    const service = getService();
    service.approve(id, body);
    return NextResponse.json(service.getDetail(id));
  });
