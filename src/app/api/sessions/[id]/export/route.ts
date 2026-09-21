import { NextResponse } from "next/server";
import { exportJson, exportMarkdown } from "@/server/workflow/export";
import { getService } from "@/server/workflow/service";
import { NotFoundError, RuleViolationError } from "@/server/workflow/errors";
import { withHandler, type Ctx } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (req: Request, ctx: Ctx) =>
  withHandler(async () => {
    const { id } = await ctx.params;
    const detail = getService().getDetail(id);
    if (!detail) throw new NotFoundError();
    if (!detail.brief) throw new RuleViolationError("This session has no brief yet");
    const format = new URL(req.url).searchParams.get("format") ?? "md";
    if (format !== "md" && format !== "json") throw new RuleViolationError("format must be md or json");
    const safeName = detail.session.id;
    return new NextResponse(format === "json" ? exportJson(detail) : exportMarkdown(detail), {
      headers: {
        "content-type": format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="readyspec-${safeName}.${format === "json" ? "json" : "md"}"`,
      },
    });
  });
