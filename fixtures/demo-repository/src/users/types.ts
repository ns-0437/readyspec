// DEMO FIXTURE - fictional code, not BetterMe's.
export interface User {
  id: string;
  email: string;
  displayName: string;
  role: "member" | "admin";
  /** IANA timezone such as "Europe/Berlin". Null until the user sets one on their profile. */
  timezone: string | null;
}
