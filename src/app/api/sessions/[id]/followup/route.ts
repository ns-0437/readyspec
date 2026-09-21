import { NextResponse } from "next/server";
import { getService } from "@/server/workflow/service";
import { withHandler, type Ctx } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts a follow-up round. `needsConsent` is true when the answers point at excerpts not yet sent. */
export const POST = (_req: Request, ctx: Ctx) =>
  withHandler(async () => {
    const { id } = await ctx.params;
    const { needsConsent } = getService().startFollowUp(id);
    return NextResponse.json({ accepted: true, needsConsent }, { status: needsConsent ? 200 : 202 });
  });
