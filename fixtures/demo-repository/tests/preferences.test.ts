// DEMO FIXTURE - fictional code, not BetterMe's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getPreferences, resetPreferencesForTests, updatePreferences } from "../src/users/preferences.ts";

test("security category cannot be disabled", () => {
  resetPreferencesForTests();
  const next = updatePreferences("u1", { categories: { security: false } as never });
  assert.equal(next.categories.security, true);
});

test("defaults leave marketing off", () => {
  resetPreferencesForTests();
  assert.equal(getPreferences("u2").categories.marketing, false);
});
