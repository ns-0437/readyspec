// DEMO FIXTURE - fictional code, not BetterMe's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideDelivery, dispatchNotification } from "../src/notifications/dispatcher.ts";
import { setSender } from "../src/notifications/channels.ts";
import { defaultPreferences, resetPreferencesForTests, updatePreferences } from "../src/users/preferences.ts";
import type { Notification } from "../src/notifications/types.ts";

const n = (category: Notification["category"]): Notification => ({
  id: "n1", userId: "u1", category, title: "t", body: "b", createdAt: new Date(0).toISOString(),
});

test("disabled category is skipped", () => {
  const prefs = defaultPreferences("u1");
  prefs.categories.marketing = false;
  assert.deepEqual(decideDelivery(n("marketing"), prefs), { deliver: false, reason: "category_disabled" });
});

test("security alerts are always delivered", () => {
  resetPreferencesForTests();
  const prefs = updatePreferences("u1", { categories: { security: false } as never });
  assert.equal(decideDelivery(n("security"), prefs).deliver, true);
});

test("enabled channels each receive the notification", async () => {
  resetPreferencesForTests();
  const sent: string[] = [];
  setSender("email", async () => { sent.push("email"); });
  setSender("push", async () => { sent.push("push"); });
  const result = await dispatchNotification(n("product"));
  assert.deepEqual(result.delivered.sort(), ["email", "push"]);
  assert.deepEqual(sent.sort(), ["email", "push"]);
});
