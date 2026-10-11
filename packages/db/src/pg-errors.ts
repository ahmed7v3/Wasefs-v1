/**
 * True when `error` is a Postgres unique violation (SQLSTATE 23505), optionally of one named
 * constraint. Drizzle may wrap the driver error as `cause`, so the chain is followed.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && typeof current === "object"; depth++) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (
      candidate.code === "23505" &&
      (constraint === undefined || candidate.constraint_name === constraint)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
