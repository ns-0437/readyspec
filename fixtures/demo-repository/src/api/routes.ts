// DEMO FIXTURE - fictional code, not BetterMe's.
import { requireUser } from "../auth/session.ts";
import { getPreferences, updatePreferences } from "../users/preferences.ts";
import type { User } from "../users/types.ts";

export interface ApiRequest {
  method: "GET" | "PUT";
  path: string;
  authorization?: string;
  body?: unknown;
}

export function handle(req: ApiRequest, users: Map<string, User>): { status: number; body: unknown } {
  const user = requireUser(req.authorization, users);
  if (req.path !== "/me/preferences") return { status: 404, body: { error: "not found" } };
  if (req.method === "GET") return { status: 200, body: getPreferences(user.id) };
  const body = (req.body ?? {}) as Record<string, unknown>;
  const digest = body.digestFrequency;
  if (digest !== undefined && !["off", "daily", "weekly"].includes(String(digest))) {
    return { status: 400, body: { error: "invalid digestFrequency" } };
  }
  return { status: 200, body: updatePreferences(user.id, body as never) };
}
