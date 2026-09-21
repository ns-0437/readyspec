import { NextResponse } from "next/server";
import { getService } from "@/server/workflow/service";
import { withHandler, type Ctx } from "../../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Decline the new follow-up excerpts and continue the round with the evidence already consented to. */
export const POST = (_req: Request, ctx: Ctx) =>
  withHandler(async () => {
    const { id } = await ctx.params;
    getService().declineFollowUpEvidence(id);
    return NextResponse.json({ accepted: true }, { status: 202 });
  });
