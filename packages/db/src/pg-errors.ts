/** Drizzle may wrap the driver error as `cause`, so the chain is followed. */
function hasSqlState(error: unknown, sqlState: string, constraint?: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && typeof current === "object"; depth++) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (
      candidate.code === sqlState &&
      (constraint === undefined || candidate.constraint_name === constraint)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/** True when `error` is a Postgres unique violation (SQLSTATE 23505), optionally of one named constraint. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  return hasSqlState(error, "23505", constraint);
}

/**
 * True when `error` is a Postgres foreign-key violation, optionally of one named constraint:
 * SQLSTATE 23503, or 23001 for a row an `on delete restrict` key still points at (Postgres reports
 * RESTRICT under its own code).
 */
export function isForeignKeyViolation(error: unknown, constraint?: string): boolean {
  return hasSqlState(error, "23503", constraint) || hasSqlState(error, "23001", constraint);
}
