// DEMO FIXTURE - fictional code, not BetterMe's.
import type { User } from "../users/types.ts";
import type { NotificationPreferences } from "../users/preferences.ts";

const DIGEST_HOUR_LOCAL = 9;

/** Next digest send time. Uses the profile timezone, falling back to UTC when unset. */
export function nextDigestAt(user: User, prefs: NotificationPreferences, now: Date): Date | null {
  if (prefs.digestFrequency === "off") return null;
  const zone = user.timezone ?? "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  const hoursUntil = (DIGEST_HOUR_LOCAL - hour + 24) % 24 || 24;
  next.setUTCHours(next.getUTCHours() + hoursUntil);
  if (prefs.digestFrequency === "weekly") next.setUTCDate(next.getUTCDate() + 6);
  return next;
}
