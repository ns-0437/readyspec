// DEMO FIXTURE - fictional code, not BetterMe's.
import { getPreferences, type NotificationPreferences } from "../users/preferences.ts";
import { senders } from "./channels.ts";
import { enqueueRetry } from "./retry-queue.ts";
import type { Channel, Notification } from "./types.ts";

export interface DeliveryDecision {
  deliver: boolean;
  reason?: "category_disabled";
}

/** Single place where preferences decide whether a notification is sent. */
export function decideDelivery(n: Notification, prefs: NotificationPreferences): DeliveryDecision {
  if (n.category === "security") return { deliver: true };
  if (!prefs.categories[n.category]) return { deliver: false, reason: "category_disabled" };
  return { deliver: true };
}

export function enabledChannels(prefs: NotificationPreferences): Channel[] {
  return (Object.keys(prefs.channels) as Channel[]).filter((c) => prefs.channels[c]);
}

export interface DispatchResult {
  delivered: Channel[];
  failed: Channel[];
  skipped?: DeliveryDecision["reason"];
}

export async function dispatchNotification(n: Notification): Promise<DispatchResult> {
  const prefs = getPreferences(n.userId);
  const decision = decideDelivery(n, prefs);
  if (!decision.deliver) return { delivered: [], failed: [], skipped: decision.reason };

  const result: DispatchResult = { delivered: [], failed: [] };
  for (const channel of enabledChannels(prefs)) {
    try {
      await senders[channel](n.userId, n);
      result.delivered.push(channel);
    } catch {
      result.failed.push(channel);
      enqueueRetry(n, channel, 1);
    }
  }
  return result;
}
