// DEMO FIXTURE - fictional code, not BetterMe's.
import { userIdForToken } from "./tokens.ts";
import type { User } from "../users/types.ts";

export class Unauthorized extends Error {
  constructor() {
    super("unauthorized");
  }
}

/** Resolves the calling user from an `Authorization: Bearer <token>` header. */
export function requireUser(authorization: string | undefined, users: Map<string, User>): User {
  const token = authorization?.replace(/^Bearer\s+/i, "");
  const id = token ? userIdForToken(token) : undefined;
  const user = id ? users.get(id) : undefined;
  if (!user) throw new Unauthorized();
  return user;
}
