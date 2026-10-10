import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { redactSecrets } from "@/shared/redact";
import { RepositoryAccessError } from "@/server/repository/safe-fs";
import { ConflictError, NotFoundError, RuleViolationError } from "@/server/workflow/errors";

export type Ctx = { params: Promise<{ id: string }> };

class PayloadTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "PayloadTooLargeError";
  }
}

class UnsupportedMediaTypeError extends Error {
  constructor() {
    super("Content-Type must be application/json");
    this.name = "UnsupportedMediaTypeError";
  }
}

/** Map domain errors to HTTP responses; anything unexpected becomes a redacted 500. */
export function toResponse(e: unknown): NextResponse {
  if (e instanceof PayloadTooLargeError) return NextResponse.json({ error: e.message }, { status: 413 });
  if (e instanceof UnsupportedMediaTypeError) return NextResponse.json({ error: e.message }, { status: 415 });
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
  const contentType = req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    throw new UnsupportedMediaTypeError();
  }
  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 400_000) {
    throw new PayloadTooLargeError();
  }
  const reader = req.body?.getReader();
  if (!reader) return schema.parse({});
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > 400_000) {
      await reader.cancel().catch(() => undefined);
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  return schema.parse(text ? JSON.parse(text) : {});
}

export async function withHandler(fn: () => Promise<NextResponse> | NextResponse): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    return toResponse(e);
  }
}
