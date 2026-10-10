import { randomInt } from "node:crypto";

import { auditLogs, organizationMembers, organizations, type createDb } from "@wasfa/db";
import { and, desc, eq } from "drizzle-orm";
import { expect } from "vitest";

import type { AuthHarness, Jar } from "./auth-harness.js";
import type { OrgMemberRole } from "@wasfa/shared/identity";

type OwnerDb = ReturnType<typeof createDb>["db"];

/** An organization created straight in the database (the owner handle bypasses the API). */
export async function insertOrg(
  db: OwnerDb,
  options: { createdBy: string; members: { userId: string; role: OrgMemberRole }[]; name?: string },
): Promise<string> {
  const [org] = await db
    .insert(organizations)
    .values({
      name: options.name ?? "Fixture Pharmacy",
      type: "pharmacy",
      country: "EG",
      createdBy: options.createdBy,
    })
    .returning({ id: organizations.id });
  if (!org) throw new Error("organization insert failed");
  await db
    .insert(organizationMembers)
    .values(options.members.map((member) => ({ orgId: org.id, ...member })));
  return org.id;
}

/** Audit rows of one action by one actor, newest first. */
export function auditRows(db: OwnerDb, action: string, actorId: string) {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.actorId, actorId), eq(auditLogs.action, action)))
    .orderBy(desc(auditLogs.createdAt));
}

export const randomIp = () => `10.${randomInt(1, 200)}.${randomInt(0, 255)}.${randomInt(1, 254)}`;

/**
 * Rate-limit check for one route: `max` requests from one fixed IP are not limited, the next one is
 * `429 RATE_LIMITED`. The IP is fresh per call, so routes never share a bucket across tests.
 */
export async function expectRateLimited(
  harness: AuthHarness,
  request: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: string;
    max: number;
    jar?: Jar;
    body?: Record<string, unknown>;
  },
): Promise<void> {
  const ip = randomIp();
  const call = () =>
    harness.call(request.method, request.url, {
      ip,
      ...(request.jar ? { jar: request.jar } : {}),
      ...(request.body ? { body: request.body } : {}),
    });
  for (let i = 0; i < request.max; i += 1) {
    expect((await call()).statusCode, `request ${i + 1} of ${request.max}`).not.toBe(429);
  }
  const limited = await call();
  expect(limited.statusCode).toBe(429);
  expect(limited.json()).toMatchObject({ code: "RATE_LIMITED" });
}
