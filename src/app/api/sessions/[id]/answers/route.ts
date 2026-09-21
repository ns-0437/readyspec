import { NextResponse } from "next/server";
import { AnswersBody } from "@/shared/schemas";
import { getService } from "@/server/workflow/service";
import { readBody, withHandler, type Ctx } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request, ctx: Ctx) =>
  withHandler(async () => {
    const { id } = await ctx.params;
    const body = await readBody(req, AnswersBody);
    const service = getService();
    service.submitAnswers(id, body.answers);
    return NextResponse.json(service.getDetail(id));
  });
