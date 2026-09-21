/** Errors the API layer maps to HTTP status codes. */
export class NotFoundError extends Error {
  constructor(what = "Session") {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

/** State conflicts: wrong status for the action, a job already running, stale revision. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** The request is well-formed but not acceptable (e.g. approving a brief that failed verification). */
export class RuleViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleViolationError";
  }
}
