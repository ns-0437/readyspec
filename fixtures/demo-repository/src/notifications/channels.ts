// DEMO FIXTURE - fictional code, not BetterMe's.
import type { Channel, Notification } from "./types.ts";

export type Sender = (userId: string, n: Notification) => Promise<void>;

export const senders: Record<Channel, Sender> = {
  email: async () => {},
  push: async () => {},
  sms: async () => {},
};

export function setSender(channel: Channel, sender: Sender): void {
  senders[channel] = sender;
}
