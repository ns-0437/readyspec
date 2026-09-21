import { NextResponse } from "next/server";
import { CreateSessionBody } from "@/shared/schemas";
import { getService } from "@/server/workflow/service";
import { readBody, withHandler } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = () => withHandler(() => NextResponse.json({ sessions: getService().list() }));

export const POST = (req: Request) =>
  withHandler(async () => {
    const body = await readBody(req, CreateSessionBody);
    const session = getService().createSession(body.repoPath, body.ticket);
    return NextResponse.json({ session }, { status: 201 });
  });
