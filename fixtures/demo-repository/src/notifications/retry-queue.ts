// DEMO FIXTURE - fictional code, not BetterMe's.
import type { Channel, Notification } from "./types.ts";

export const MAX_ATTEMPTS = 3;

export interface RetryJob {
  notification: Notification;
  channel: Channel;
  attempts: number;
  nextAttemptAt: number;
}

const queue: RetryJob[] = [];

export function enqueueRetry(notification: Notification, channel: Channel, attempts: number, now = Date.now()): boolean {
  if (attempts >= MAX_ATTEMPTS) return false;
  queue.push({ notification, channel, attempts, nextAttemptAt: now + 2 ** attempts * 1000 });
  return true;
}

/** Jobs are retried regardless of the user's current preferences (they are checked only at first dispatch). */
export function dueJobs(now = Date.now()): RetryJob[] {
  return queue.filter((j) => j.nextAttemptAt <= now);
}

export function clearQueueForTests(): void {
  queue.length = 0;
}
