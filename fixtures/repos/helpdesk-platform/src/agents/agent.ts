// EVALUATION FIXTURE - fictional code.
export interface Agent {
  id: string;
  name: string;
  email: string;
  teamId: string;
  role: "agent" | "lead" | "admin";
  /** Maximum tickets that can be assigned to this agent at once. */
  capacity: number;
}

export interface Team {
  id: string;
  name: string;
}
