// DEMO FIXTURE - fictional code, not BetterMe's.
export type NotificationCategory = "security" | "billing" | "product" | "marketing";
export type Channel = "email" | "push" | "sms";

export interface Notification {
  id: string;
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  createdAt: string;
}
