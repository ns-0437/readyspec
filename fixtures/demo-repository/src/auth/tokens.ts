// DEMO FIXTURE - fictional code, not BetterMe's.
import type { User } from "../users/types.ts";

const tokenTable = new Map<string, string>();

export function issueToken(user: User): string {
  const token = `tok_${user.id}_${tokenTable.size + 1}`;
  tokenTable.set(token, user.id);
  return token;
}

export function userIdForToken(token: string): string | undefined {
  return tokenTable.get(token);
}
