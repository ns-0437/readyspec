// DEMO FIXTURE - fictional code, not BetterMe's.
import type { Channel, NotificationCategory } from "../notifications/types.ts";

export interface NotificationPreferences {
  userId: string;
  channels: Record<Channel, boolean>;
  categories: Record<NotificationCategory, boolean>;
  digestFrequency: "off" | "daily" | "weekly";
  updatedAt: string;
}

export function defaultPreferences(userId: string, now = new Date()): NotificationPreferences {
  return {
    userId,
    channels: { email: true, push: true, sms: false },
    // NOTE: marketing starts off, unlike docs/notifications.md which says all categories default on.
    categories: { security: true, billing: true, product: true, marketing: false },
    digestFrequency: "off",
    updatedAt: now.toISOString(),
  };
}

const store = new Map<string, NotificationPreferences>();

export function getPreferences(userId: string): NotificationPreferences {
  return store.get(userId) ?? defaultPreferences(userId);
}

/** Security alerts can never be disabled: the flag is forced back on. */
export function updatePreferences(
  userId: string,
  patch: Partial<Pick<NotificationPreferences, "channels" | "categories" | "digestFrequency">>,
  now = new Date(),
): NotificationPreferences {
  const current = getPreferences(userId);
  const next: NotificationPreferences = {
    ...current,
    ...patch,
    channels: { ...current.channels, ...patch.channels },
    categories: { ...current.categories, ...patch.categories, security: true },
    updatedAt: now.toISOString(),
  };
  store.set(userId, next);
  return next;
}

export function resetPreferencesForTests(): void {
  store.clear();
}
