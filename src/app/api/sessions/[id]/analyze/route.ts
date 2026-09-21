import { NextResponse } from "next/server";
import { z } from "zod";
import { getService } from "@/server/workflow/service";
import { RuleViolationError } from "@/server/workflow/errors";
import { readBody, withHandler, type Ctx } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts behavior analysis + first clarification. Requires explicit consent to the disclosed excerpts. */
export const POST = (req: Request, ctx: Ctx) =>
  withHandler(async () => {
    const { id } = await ctx.params;
    const body = await readBody(req, z.object({ consent: z.boolean() }));
    if (!body.consent) throw new RuleViolationError("Consent to the disclosed excerpts is required");
    getService().startAnalysis(id);
    return NextResponse.json({ accepted: true }, { status: 202 });
  });
