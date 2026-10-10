/**
 * Thrown by a handler that cannot run yet but must not burn a retry (the daily mail cap). The
 * processor moves the job to the delayed set until `until` (epoch ms) instead of failing it.
 */
export class DeferJob extends Error {
  constructor(
    readonly until: number,
    readonly reason: string,
  ) {
    super(`Deferred: ${reason}`);
    this.name = "DeferJob";
  }
}
