import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { redactSecrets } from "@/shared/redact";
import { RepositoryAccessError } from "@/server/repository/safe-fs";
import { ConflictError, NotFoundError, RuleViolationError } from "@/server/workflow/errors";

export type Ctx = { params: Promise<{ id: string }> };

/** Map domain errors to HTTP responses; anything unexpected becomes a redacted 500. */
export function toResponse(e: unknown): NextResponse {
  if (e instanceof ZodError) {
    return NextResponse.json({ error: "Invalid request", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
  }
  if (e instanceof SyntaxError) return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  if (e instanceof RepositoryAccessError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
  if (e instanceof ConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
  if (e instanceof RuleViolationError) return NextResponse.json({ error: e.message }, { status: 422 });
  console.error("[readyspec] unexpected API error:", redactSecrets((e as Error)?.stack ?? String(e)));
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

export async function readBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const text = await req.text();
  if (text.length > 400_000) throw new RuleViolationError("Request body too large");
  return schema.parse(text ? JSON.parse(text) : {});
}

export async function withHandler(fn: () => Promise<NextResponse> | NextResponse): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    return toResponse(e);
  }
}
