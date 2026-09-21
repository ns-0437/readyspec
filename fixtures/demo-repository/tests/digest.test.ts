// DEMO FIXTURE - fictional code, not BetterMe's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextDigestAt } from "../src/notifications/digest.ts";
import { defaultPreferences } from "../src/users/preferences.ts";
import type { User } from "../src/users/types.ts";

const user: User = { id: "u1", email: "a@demo.invalid", displayName: "Demo", role: "member", timezone: null };

test("no digest when frequency is off", () => {
  assert.equal(nextDigestAt(user, defaultPreferences("u1"), new Date("2026-01-01T00:00:00Z")), null);
});

test("digest falls back to UTC when the profile has no timezone", () => {
  const prefs = { ...defaultPreferences("u1"), digestFrequency: "daily" as const };
  const at = nextDigestAt(user, prefs, new Date("2026-01-01T00:00:00Z"));
  assert.equal(at?.toISOString(), "2026-01-01T09:00:00.000Z");
});
