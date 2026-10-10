import { expect } from "vitest";

import type { LightMyRequestResponse } from "fastify";

/**
 * The wrong-owner test pattern (Task 1.6). Every endpoint that addresses a user- or organization-owned
 * row by id is tested with it: the owner succeeds, a different signed-in user gets `NOT_FOUND`
 * (never `FORBIDDEN`, so ids cannot be probed), and the row is unchanged by the failed attempt.
 *
 * The intruder runs FIRST, so a destructive endpoint is proven harmless before the owner uses it.
 */
export async function wrongOwnerIsHidden(options: {
  /** The request as the row's owner; expected to succeed (2xx). */
  owner: () => Promise<LightMyRequestResponse>;
  /** The same request as another signed-in user. */
  intruder: () => Promise<LightMyRequestResponse>;
  /** True while the row still exists in its original state. */
  stillThere: () => Promise<boolean>;
}): Promise<void> {
  const foreign = await options.intruder();
  expect(foreign.statusCode).toBe(404);
  expect(foreign.json()).toMatchObject({ code: "NOT_FOUND" });
  expect(await options.stillThere()).toBe(true);

  const own = await options.owner();
  expect(own.statusCode).toBeGreaterThanOrEqual(200);
  expect(own.statusCode).toBeLessThan(300);
}
