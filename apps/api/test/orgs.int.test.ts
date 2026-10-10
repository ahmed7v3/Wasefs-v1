import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";

import {
  auditLogs,
  createDb,
  organizationInvites,
  organizationMembers,
  organizations,
  seedDefaults,
  users,
} from "@wasfa/db";
import { decodeEncryptionKey, decryptSecret } from "@wasfa/shared/crypto";
import { emailSecretContext, emailSendPayloadSchema } from "@wasfa/shared/email";
import {
  MAX_INVITES_PER_USER_PER_DAY,
  MAX_PENDING_INVITES_PER_ORG,
  leaveOrgResponseSchema,
  myInviteListResponseSchema,
  orgInviteListResponseSchema,
  orgInviteSchema,
  orgListResponseSchema,
  orgMemberListResponseSchema,
  orgMemberSchema,
  orgResponseSchema,
} from "@wasfa/shared/schemas/org";
import { Queue } from "bullmq";
import { and, eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/bootstrap.js";

import { AuthHarness, pwnedHandlers, testApiEnv, type Jar } from "./support/auth-harness.js";
import { startInfra, type TestInfra } from "./support/infra.js";
import { wrongOwnerIsHidden } from "./support/wrong-owner.js";

import type { ApiEnv } from "../src/config/env.js";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { OrgMemberRole } from "@wasfa/shared/identity";

const network = setupServer(
  ...pwnedHandlers(),
  http.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", () =>
    HttpResponse.json({ success: true }),
  ),
);

let infra: TestInfra;
let env: ApiEnv;
let app: NestFastifyApplication;
let handle: ReturnType<typeof createDb>;
let redis: Redis;
let queue: Queue;
const harness = new AuthHarness(
  () => app,
  () => handle.db,
);

interface Person {
  email: string;
  jar: Jar;
  userId: string;
}
/** Never a member of any fixture organization: the "someone else" of every wrong-owner check. */
let outsider: Person;

beforeAll(async () => {
  infra = await startInfra();
  network.listen({ onUnhandledRequest: "error" });
  env = testApiEnv(infra);
  handle = createDb({ url: infra.databaseUrl, max: 2 });
  await seedDefaults(handle.db);
  app = await createApp(env, { extraImports: [harness.mailerModule()], authMailer: false });
  redis = new Redis(infra.redisUrl, { maxRetriesPerRequest: null });
  queue = new Queue("notifications", { connection: redis });
  outsider = await harness.signedInUser();
}, 120_000);

afterAll(async () => {
  network.close();
  await queue?.close();
  await redis?.quit();
  await app?.close();
  await handle?.close();
  await infra?.stop();
});

// --- helpers ---

type Method = "GET" | "POST" | "PATCH" | "DELETE";

function call(method: Method, url: string, jar: Jar, body?: Record<string, unknown>, ip?: string) {
  return harness.call(method, url, {
    jar,
    ...(body ? { body } : {}),
    ...(ip ? { ip } : {}),
  });
}

const newPhone = () => `+2010${randomInt(10_000_000, 99_999_999)}`;
const newEmail = () => `invitee-${randomBytes(4).toString("hex")}@example.com`;
const randomIp = () => `172.20.${randomInt(1, 250)}.${randomInt(1, 250)}`;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function makeOrg(
  members: { person: Person; role: OrgMemberRole }[],
  name = "عيادة النور",
): Promise<string> {
  const founder = members[0];
  if (!founder) throw new Error("an organization needs a founder");
  const [org] = await handle.db
    .insert(organizations)
    .values({
      name,
      type: "clinic",
      country: "EG",
      city: "Cairo",
      createdBy: founder.person.userId,
    })
    .returning({ id: organizations.id });
  if (!org) throw new Error("org insert failed");
  await handle.db
    .insert(organizationMembers)
    .values(members.map((m) => ({ orgId: org.id, userId: m.person.userId, role: m.role })));
  return org.id;
}

async function orgExists(orgId: string): Promise<boolean> {
  const rows = await handle.db.select().from(organizations).where(eq(organizations.id, orgId));
  return rows.length > 0;
}

async function memberRole(orgId: string, userId: string): Promise<OrgMemberRole | null> {
  const [row] = await handle.db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)));
  return row?.role ?? null;
}

async function inviteRow(inviteId: string) {
  const [row] = await handle.db
    .select()
    .from(organizationInvites)
    .where(eq(organizationInvites.id, inviteId));
  return row ?? null;
}

/** An invitation inserted directly (to control expiry, state and token). */
async function insertInvite(options: {
  orgId: string;
  email?: string;
  phone?: string;
  role?: OrgMemberRole;
  expiresAt?: Date;
  acceptedAt?: Date;
  invitedBy?: string;
}): Promise<{ id: string; token: string }> {
  const token = randomBytes(32).toString("base64url");
  const [row] = await handle.db
    .insert(organizationInvites)
    .values({
      orgId: options.orgId,
      ...(options.email ? { email: options.email } : {}),
      ...(options.phone ? { phone: options.phone } : {}),
      tokenHash: sha256(token),
      role: options.role ?? "org_member",
      invitedBy: options.invitedBy ?? null,
      expiresAt: options.expiresAt ?? new Date(Date.now() + 86_400_000),
      acceptedAt: options.acceptedAt ?? null,
    })
    .returning({ id: organizationInvites.id });
  if (!row) throw new Error("invite insert failed");
  return { id: row.id, token };
}

async function verifyPhone(userId: string, phone: string, verified = true): Promise<void> {
  await handle.db
    .update(users)
    .set({ phone, phoneVerified: verified, phoneVerifiedAt: verified ? new Date() : null })
    .where(eq(users.id, userId));
}

async function auditRows(action: string, targetId: string) {
  return handle.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.targetId, targetId)));
}

async function rbacCacheKeys(userId: string): Promise<string[]> {
  return redis.keys(`rbac:*:u:${userId}`);
}

async function jobsFor(to: string) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const jobs = await queue.getJobs(["waiting", "active", "delayed", "completed"]);
    const found = jobs.filter((job) => (job.data as { to?: string }).to === to);
    if (found.length > 0) return found;
    if (Date.now() > deadline) throw new Error("no job was queued");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function noJobsFor(to: string): Promise<boolean> {
  const jobs = await queue.getJobs(["waiting", "active", "delayed", "completed", "failed"]);
  return jobs.every((job) => (job.data as { to?: string }).to !== to);
}

/** The link of the invitation email, decrypted like the worker does. */
async function inviteLinkFor(to: string): Promise<{ link: string; token: string; data: unknown }> {
  const [job] = await jobsFor(to);
  if (!job) throw new Error("unreachable");
  const payload = emailSendPayloadSchema.parse(job.data);
  if (payload.template !== "org_invite") throw new Error("expected an org_invite job");
  const link = decryptSecret(
    payload.encryptedLink,
    decodeEncryptionKey(env.ENCRYPTION_KEY),
    emailSecretContext("org_invite"),
  );
  return { link, token: new URL(link).hash.slice(1), data: job.data };
}

async function admin(): Promise<Person> {
  return harness.signedInUser();
}

/** An organization with one admin and (optionally) members; everybody is signed in. */
async function fixture(memberCount = 0) {
  const owner = await admin();
  const members: Person[] = [];
  for (let i = 0; i < memberCount; i++) members.push(await harness.signedInUser());
  const orgId = await makeOrg([
    { person: owner, role: "org_admin" },
    ...members.map((person) => ({ person, role: "org_member" as const })),
  ]);
  return { owner, members, orgId };
}

// --- every route requires a session ---

describe("authentication", () => {
  const someId = randomUUID();
  const routes: [Method, string][] = [
    ["GET", "/orgs"],
    ["GET", `/orgs/${someId}`],
    ["PATCH", `/orgs/${someId}`],
    ["GET", `/orgs/${someId}/members`],
    ["PATCH", `/orgs/${someId}/members/${someId}`],
    ["DELETE", `/orgs/${someId}/members/${someId}`],
    ["POST", `/orgs/${someId}/leave`],
    ["GET", `/orgs/${someId}/invites`],
    ["POST", `/orgs/${someId}/invites`],
    ["DELETE", `/orgs/${someId}/invites/${someId}`],
    ["GET", "/me/invites"],
    ["POST", `/me/invites/${someId}/accept`],
    ["POST", "/invites/accept"],
  ];

  it.each(routes)("%s %s answers 401 without a session", async (method, url) => {
    const res = await call(method, url, new Map());
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  });
});

// --- organizations ---

describe("GET /orgs", () => {
  it("lists my organizations with my role and the member count, and nobody else's", async () => {
    const { owner, members, orgId } = await fixture(2);
    const otherOrg = await makeOrg([{ person: members[0] as Person, role: "org_admin" }]);
    const foreign = await fixture();

    const res = await call("GET", "/orgs", owner.jar);
    expect(res.statusCode).toBe(200);
    const list = orgListResponseSchema.parse(res.json());
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: orgId,
      name: "عيادة النور",
      type: "clinic",
      country: "EG",
      city: "Cairo",
      myRole: "org_admin",
      memberCount: 3,
    });

    const asMember = orgListResponseSchema.parse(
      (await call("GET", "/orgs", (members[0] as Person).jar)).json(),
    );
    expect(asMember.items.map((item) => [item.id, item.myRole]).sort()).toEqual(
      [
        [orgId, "org_member"],
        [otherOrg, "org_admin"],
      ].sort(),
    );
    expect(JSON.stringify(list)).not.toContain(foreign.orgId);
  });

  it("is an empty list for someone with no organization", async () => {
    const res = await call("GET", "/orgs", outsider.jar);
    expect(orgListResponseSchema.parse(res.json()).items).toEqual([]);
  });
});

describe("GET /orgs/:id", () => {
  it("returns the organization to a member and hides it from everyone else", async () => {
    const { owner, members, orgId } = await fixture(1);
    await wrongOwnerIsHidden({
      owner: () => call("GET", `/orgs/${orgId}`, owner.jar),
      intruder: () => call("GET", `/orgs/${orgId}`, outsider.jar),
      stillThere: () => orgExists(orgId),
    });
    const res = await call("GET", `/orgs/${orgId}`, (members[0] as Person).jar);
    expect(res.statusCode).toBe(200);
    expect(orgResponseSchema.parse(res.json())).toMatchObject({
      id: orgId,
      myRole: "org_member",
      memberCount: 2,
    });
  });

  it("rejects an id that is not a uuid", async () => {
    const res = await call("GET", "/orgs/not-a-uuid", outsider.jar);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("PATCH /orgs/:id", () => {
  it("lets an org_admin update the organization and audits before and after", async () => {
    const { owner, orgId } = await fixture();
    const res = await call("PATCH", `/orgs/${orgId}`, owner.jar, {
      name: "  صيدلية الشفاء  ",
      type: "pharmacy",
      country: "sa",
    });
    expect(res.statusCode).toBe(200);
    const updated = orgResponseSchema.parse(res.json());
    expect(updated).toMatchObject({
      name: "صيدلية الشفاء",
      type: "pharmacy",
      country: "SA",
      city: "Cairo",
      myRole: "org_admin",
    });

    const [row] = await auditRows("org.update", orgId);
    expect(row).toMatchObject({ actorId: owner.userId, targetType: "org" });
    expect(row?.before).toMatchObject({ name: "عيادة النور", type: "clinic", country: "EG" });
    expect(row?.after).toMatchObject({ name: "صيدلية الشفاء", type: "pharmacy", country: "SA" });
  });

  it("clears the city with null and leaves untouched fields alone", async () => {
    const { owner, orgId } = await fixture();
    const res = await call("PATCH", `/orgs/${orgId}`, owner.jar, { city: null });
    expect(orgResponseSchema.parse(res.json())).toMatchObject({ city: null, name: "عيادة النور" });
  });

  it("answers 403 to a member who is not an admin, and changes nothing", async () => {
    const { members, orgId } = await fixture(1);
    const res = await call("PATCH", `/orgs/${orgId}`, (members[0] as Person).jar, {
      name: "Hacked",
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "FORBIDDEN" });
    const [row] = await handle.db.select().from(organizations).where(eq(organizations.id, orgId));
    expect(row?.name).toBe("عيادة النور");
  });

  it("hides the organization from non-members", async () => {
    const { owner, orgId } = await fixture();
    await wrongOwnerIsHidden({
      owner: () => call("PATCH", `/orgs/${orgId}`, owner.jar, { name: "New name" }),
      intruder: () => call("PATCH", `/orgs/${orgId}`, outsider.jar, { name: "Stolen" }),
      stillThere: async () => {
        const [row] = await handle.db
          .select()
          .from(organizations)
          .where(eq(organizations.id, orgId));
        return row?.name === "عيادة النور";
      },
    });
  });

  it.each([
    ["an empty body", {}],
    ["a name that is too short", { name: "x" }],
    ["an unknown type", { type: "spa" }],
    ["a malformed country", { country: "EGY" }],
  ])("rejects %s", async (_label, body) => {
    const { owner, orgId } = await fixture();
    const res = await call("PATCH", `/orgs/${orgId}`, owner.jar, body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

// --- members ---

describe("GET /orgs/:id/members", () => {
  it("lists names and roles, marks me, and exposes no email or phone", async () => {
    const { owner, members, orgId } = await fixture(1);
    const member = members[0] as Person;
    await verifyPhone(member.userId, newPhone());

    await wrongOwnerIsHidden({
      owner: () => call("GET", `/orgs/${orgId}/members`, member.jar),
      intruder: () => call("GET", `/orgs/${orgId}/members`, outsider.jar),
      stillThere: () => orgExists(orgId),
    });

    const res = await call("GET", `/orgs/${orgId}/members`, owner.jar);
    expect(res.statusCode).toBe(200);
    const list = orgMemberListResponseSchema.parse(res.json());
    expect(list.items).toHaveLength(2);
    expect(list.items.find((item) => item.userId === owner.userId)).toMatchObject({
      role: "org_admin",
      isMe: true,
    });
    expect(list.items.find((item) => item.userId === member.userId)).toMatchObject({
      role: "org_member",
      isMe: false,
    });
    const raw = res.body;
    expect(raw).not.toContain(owner.email);
    expect(raw).not.toContain(member.email);
    expect(raw).not.toContain("+2010");
  });
});

describe("PATCH /orgs/:id/members/:userId", () => {
  it("promotes a member, audits it, and returns the member", async () => {
    const { owner, members, orgId } = await fixture(1);
    const member = members[0] as Person;
    const res = await call("PATCH", `/orgs/${orgId}/members/${member.userId}`, owner.jar, {
      role: "org_admin",
    });
    expect(res.statusCode).toBe(200);
    expect(orgMemberSchema.parse(res.json())).toMatchObject({
      userId: member.userId,
      role: "org_admin",
      isMe: false,
    });
    expect(await memberRole(orgId, member.userId)).toBe("org_admin");

    const [row] = await auditRows("org.member_role_change", member.userId);
    expect(row).toMatchObject({ actorId: owner.userId, targetType: "org_member" });
    expect(row?.before).toEqual({ role: "org_member" });
    expect(row?.after).toEqual({ role: "org_admin" });
  });

  it("lets an admin step down while another admin remains", async () => {
    const { owner, members, orgId } = await fixture(1);
    const second = members[0] as Person;
    await handle.db
      .update(organizationMembers)
      .set({ role: "org_admin" })
      .where(eq(organizationMembers.userId, second.userId));
    const res = await call("PATCH", `/orgs/${orgId}/members/${owner.userId}`, owner.jar, {
      role: "org_member",
    });
    expect(res.statusCode).toBe(200);
    expect(await memberRole(orgId, owner.userId)).toBe("org_member");
  });

  it("refuses to demote the last org_admin (CONFLICT last_org_admin)", async () => {
    const { owner, orgId } = await fixture(1);
    const res = await call("PATCH", `/orgs/${orgId}/members/${owner.userId}`, owner.jar, {
      role: "org_member",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "CONFLICT", details: { reason: "last_org_admin" } });
    expect(await memberRole(orgId, owner.userId)).toBe("org_admin");
    expect(await auditRows("org.member_role_change", owner.userId)).toHaveLength(0);
  });

  it("keeps one admin when two admins demote each other at the same time", async () => {
    const { owner, members, orgId } = await fixture(1);
    const second = members[0] as Person;
    await handle.db
      .update(organizationMembers)
      .set({ role: "org_admin" })
      .where(eq(organizationMembers.userId, second.userId));
    const results = await Promise.all([
      call("PATCH", `/orgs/${orgId}/members/${second.userId}`, owner.jar, { role: "org_member" }),
      call("PATCH", `/orgs/${orgId}/members/${owner.userId}`, second.jar, { role: "org_member" }),
    ]);
    // The loser is refused either by the lock (409) or, if the winner already finished, because it is no longer an admin (403).
    const statuses = results.map((res) => res.statusCode).sort();
    expect(statuses[0]).toBe(200);
    expect([403, 409]).toContain(statuses[1]);
    const roles = await Promise.all([
      memberRole(orgId, owner.userId),
      memberRole(orgId, second.userId),
    ]);
    expect(roles.filter((role) => role === "org_admin")).toHaveLength(1);
  });

  it("answers NOT_FOUND for a user who is not a member", async () => {
    const { owner, orgId } = await fixture();
    const res = await call("PATCH", `/orgs/${orgId}/members/${outsider.userId}`, owner.jar, {
      role: "org_admin",
    });
    expect(res.statusCode).toBe(404);
    expect(await memberRole(orgId, outsider.userId)).toBeNull();
  });

  it("answers 403 to a plain member and hides the organization from non-members", async () => {
    const { owner, members, orgId } = await fixture(2);
    const [first, second] = members as [Person, Person];
    const forbidden = await call("PATCH", `/orgs/${orgId}/members/${second.userId}`, first.jar, {
      role: "org_admin",
    });
    expect(forbidden.statusCode).toBe(403);
    expect(await memberRole(orgId, second.userId)).toBe("org_member");

    await wrongOwnerIsHidden({
      owner: () =>
        call("PATCH", `/orgs/${orgId}/members/${second.userId}`, owner.jar, { role: "org_admin" }),
      intruder: () =>
        call("PATCH", `/orgs/${orgId}/members/${second.userId}`, outsider.jar, {
          role: "org_admin",
        }),
      stillThere: async () => (await memberRole(orgId, second.userId)) === "org_member",
    });
  });

  it.each([
    ["an unknown role", { role: "owner" }],
    ["no role", {}],
  ])("rejects %s", async (_label, body) => {
    const { owner, members, orgId } = await fixture(1);
    const res = await call(
      "PATCH",
      `/orgs/${orgId}/members/${(members[0] as Person).userId}`,
      owner.jar,
      body,
    );
    expect(res.statusCode).toBe(400);
  });
});

describe("DELETE /orgs/:id/members/:userId", () => {
  it("removes a member, audits it, and busts the member's cached access", async () => {
    const { owner, members, orgId } = await fixture(1);
    const member = members[0] as Person;
    // Prime the member's cached access (it lists the organization).
    await call("GET", "/orgs", member.jar);
    expect(await rbacCacheKeys(member.userId)).not.toHaveLength(0);

    const res = await call("DELETE", `/orgs/${orgId}/members/${member.userId}`, owner.jar);
    expect(res.statusCode).toBe(204);
    expect(await memberRole(orgId, member.userId)).toBeNull();
    expect(await rbacCacheKeys(member.userId)).toHaveLength(0);

    const [row] = await auditRows("org.member_remove", member.userId);
    expect(row).toMatchObject({ actorId: owner.userId, targetType: "org_member" });
    // The removed member lost access at once.
    expect((await call("GET", `/orgs/${orgId}`, member.jar)).statusCode).toBe(404);
  });

  it("refuses to remove yourself (CONFLICT use_leave)", async () => {
    const { owner, orgId } = await fixture(1);
    const res = await call("DELETE", `/orgs/${orgId}/members/${owner.userId}`, owner.jar);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "CONFLICT", details: { reason: "use_leave" } });
    expect(await memberRole(orgId, owner.userId)).toBe("org_admin");
  });

  it("answers NOT_FOUND for a user who is not a member", async () => {
    const { owner, orgId } = await fixture();
    const res = await call("DELETE", `/orgs/${orgId}/members/${outsider.userId}`, owner.jar);
    expect(res.statusCode).toBe(404);
  });

  it("answers 403 to a plain member and hides the organization from non-members", async () => {
    const { owner, members, orgId } = await fixture(2);
    const [first, second] = members as [Person, Person];
    const forbidden = await call("DELETE", `/orgs/${orgId}/members/${second.userId}`, first.jar);
    expect(forbidden.statusCode).toBe(403);
    expect(await memberRole(orgId, second.userId)).toBe("org_member");

    await wrongOwnerIsHidden({
      owner: () => call("DELETE", `/orgs/${orgId}/members/${second.userId}`, owner.jar),
      intruder: () => call("DELETE", `/orgs/${orgId}/members/${second.userId}`, outsider.jar),
      stillThere: async () => (await memberRole(orgId, second.userId)) === "org_member",
    });
  });

  it("rejects ids that are not uuids", async () => {
    const { owner, orgId } = await fixture();
    const res = await call("DELETE", `/orgs/${orgId}/members/nope`, owner.jar);
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /orgs/:id/leave", () => {
  it("lets a member leave, busts their access and audits it", async () => {
    const { members, orgId } = await fixture(1);
    const member = members[0] as Person;
    await call("GET", "/orgs", member.jar);
    expect(await rbacCacheKeys(member.userId)).not.toHaveLength(0);

    const res = await call("POST", `/orgs/${orgId}/leave`, member.jar);
    expect(res.statusCode).toBe(200);
    expect(leaveOrgResponseSchema.parse(res.json())).toEqual({ orgDeleted: false });
    expect(await memberRole(orgId, member.userId)).toBeNull();
    expect(await orgExists(orgId)).toBe(true);
    expect(await rbacCacheKeys(member.userId)).toHaveLength(0);

    const rows = await auditRows("org.leave", orgId);
    expect(rows.map((row) => row.actorId)).toEqual([member.userId]);
    expect(await auditRows("org.delete", orgId)).toHaveLength(0);
  });

  it("refuses to let the only org_admin leave while others remain", async () => {
    const { owner, orgId } = await fixture(1);
    const res = await call("POST", `/orgs/${orgId}/leave`, owner.jar);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "CONFLICT", details: { reason: "last_org_admin" } });
    expect(await memberRole(orgId, owner.userId)).toBe("org_admin");
  });

  it("lets an admin leave when another admin remains", async () => {
    const { owner, members, orgId } = await fixture(1);
    await handle.db
      .update(organizationMembers)
      .set({ role: "org_admin" })
      .where(eq(organizationMembers.userId, (members[0] as Person).userId));
    const res = await call("POST", `/orgs/${orgId}/leave`, owner.jar);
    expect(res.statusCode).toBe(200);
    expect(await memberRole(orgId, owner.userId)).toBeNull();
  });

  it("deletes the organization, its members and invites when the last member leaves", async () => {
    const { owner, orgId } = await fixture();
    const invite = await insertInvite({ orgId, email: newEmail() });
    const res = await call("POST", `/orgs/${orgId}/leave`, owner.jar);
    expect(res.statusCode).toBe(200);
    expect(leaveOrgResponseSchema.parse(res.json())).toEqual({ orgDeleted: true });
    expect(await orgExists(orgId)).toBe(false);
    expect(await inviteRow(invite.id)).toBeNull();
    expect(await auditRows("org.leave", orgId)).toHaveLength(1);
    expect(await auditRows("org.delete", orgId)).toHaveLength(1);
  });

  it("hides the organization from non-members", async () => {
    const { members, orgId } = await fixture(1);
    await wrongOwnerIsHidden({
      owner: () => call("POST", `/orgs/${orgId}/leave`, (members[0] as Person).jar),
      intruder: () => call("POST", `/orgs/${orgId}/leave`, outsider.jar),
      stillThere: async () => (await memberRole(orgId, (members[0] as Person).userId)) !== null,
    });
  });
});

// --- invitations of an organization ---

describe("GET /orgs/:id/invites", () => {
  it("lists pending invitations with masked targets only", async () => {
    const { owner, orgId } = await fixture();
    const email = "samira.hassan@example.com";
    const phone = "+201012345678";
    await insertInvite({ orgId, email, invitedBy: owner.userId });
    await insertInvite({ orgId, phone, role: "org_admin", invitedBy: owner.userId });
    await insertInvite({ orgId, email: newEmail(), acceptedAt: new Date() });
    await insertInvite({ orgId, email: newEmail(), expiresAt: new Date(Date.now() - 1000) });

    const res = await call("GET", `/orgs/${orgId}/invites`, owner.jar);
    expect(res.statusCode).toBe(200);
    const list = orgInviteListResponseSchema.parse(res.json());
    expect(list.items).toHaveLength(2);
    expect(list.items.find((item) => item.channel === "email")).toMatchObject({
      target: "s•••@example.com",
      role: "org_member",
    });
    expect(list.items.find((item) => item.channel === "phone")).toMatchObject({
      target: "+2010••••••78",
      role: "org_admin",
    });
    expect(res.body).not.toContain(email);
    expect(res.body).not.toContain(phone);
    expect(res.body).not.toContain("tokenHash");
  });

  it("answers 403 to a plain member and hides the organization from non-members", async () => {
    const { owner, members, orgId } = await fixture(1);
    expect(
      (await call("GET", `/orgs/${orgId}/invites`, (members[0] as Person).jar)).statusCode,
    ).toBe(403);
    await wrongOwnerIsHidden({
      owner: () => call("GET", `/orgs/${orgId}/invites`, owner.jar),
      intruder: () => call("GET", `/orgs/${orgId}/invites`, outsider.jar),
      stillThere: () => orgExists(orgId),
    });
  });
});

describe("POST /orgs/:id/invites", () => {
  it("creates an email invitation: the link with the token in the fragment is queued, only its hash is stored", async () => {
    const { owner, orgId } = await fixture();
    const to = newEmail();
    const res = await call("POST", `/orgs/${orgId}/invites`, owner.jar, {
      email: to.toUpperCase(),
      role: "org_admin",
    });
    expect(res.statusCode).toBe(201);
    const invite = orgInviteSchema.parse(res.json());
    expect(invite).toMatchObject({ channel: "email", role: "org_admin" });
    expect(invite.target).toMatch(/^i•••@example\.com$/);
    expect(res.body).not.toContain(to);
    expect(new Date(invite.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6.9 * 86_400_000);
    expect(new Date(invite.expiresAt).getTime()).toBeLessThan(Date.now() + 7.1 * 86_400_000);

    const { link, token, data } = await inviteLinkFor(to);
    expect(link).toBe(`https://wasfa.online/invite#${token}`);
    expect(new URL(link).search).toBe("");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data).toMatchObject({ template: "org_invite", orgName: "عيادة النور" });
    // The token is encrypted in the queue.
    expect(JSON.stringify(data)).not.toContain(token);

    const row = await inviteRow(invite.id);
    expect(row).toMatchObject({
      orgId,
      email: to,
      phone: null,
      role: "org_admin",
      invitedBy: owner.userId,
      acceptedAt: null,
      tokenHash: sha256(token),
    });
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("audits the creation without the email or phone", async () => {
    const { owner, orgId } = await fixture();
    const to = newEmail();
    const res = await call("POST", `/orgs/${orgId}/invites`, owner.jar, { email: to });
    const invite = orgInviteSchema.parse(res.json());
    const [row] = await auditRows("org.invite_create", invite.id);
    expect(row).toMatchObject({ actorId: owner.userId, targetType: "org_invite" });
    expect(row?.after).toEqual({ role: "org_member", channel: "email" });
    expect(JSON.stringify(row)).not.toContain(to);
  });

  it("creates a phone invitation and sends nothing", async () => {
    const { owner, orgId } = await fixture();
    const phone = newPhone();
    const res = await call("POST", `/orgs/${orgId}/invites`, owner.jar, { phone });
    expect(res.statusCode).toBe(201);
    const invite = orgInviteSchema.parse(res.json());
    expect(invite).toMatchObject({ channel: "phone", role: "org_member" });
    expect(res.body).not.toContain(phone);
    expect(await inviteRow(invite.id)).toMatchObject({ phone, email: null });
    expect(await noJobsFor(phone)).toBe(true);
    const [row] = await auditRows("org.invite_create", invite.id);
    expect(row?.after).toEqual({ role: "org_member", channel: "phone" });
    expect(JSON.stringify(row)).not.toContain(phone);
  });

  it("refuses a second pending invitation for the same target (invite_pending)", async () => {
    const { owner, orgId } = await fixture();
    const to = newEmail();
    expect(
      (await call("POST", `/orgs/${orgId}/invites`, owner.jar, { email: to })).statusCode,
    ).toBe(201);
    const again = await call("POST", `/orgs/${orgId}/invites`, owner.jar, { email: to });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: "CONFLICT", details: { reason: "invite_pending" } });

    // An expired invitation does not block a new one.
    const phone = newPhone();
    await insertInvite({ orgId, phone, expiresAt: new Date(Date.now() - 1000) });
    expect((await call("POST", `/orgs/${orgId}/invites`, owner.jar, { phone })).statusCode).toBe(
      201,
    );
  });

  it("refuses to invite someone who is already a member by verified email or phone", async () => {
    const { owner, members, orgId } = await fixture(2);
    const [byEmail, byPhone] = members as [Person, Person];
    const phone = newPhone();
    await verifyPhone(byPhone.userId, phone);

    const email = await call("POST", `/orgs/${orgId}/invites`, owner.jar, { email: byEmail.email });
    expect(email.statusCode).toBe(409);
    expect(email.json()).toMatchObject({ details: { reason: "already_member" } });
    const phoneRes = await call("POST", `/orgs/${orgId}/invites`, owner.jar, { phone });
    expect(phoneRes.statusCode).toBe(409);
    expect(phoneRes.json()).toMatchObject({ details: { reason: "already_member" } });
  });

  it("does not treat an unverified phone claim as membership", async () => {
    const { owner, members, orgId } = await fixture(1);
    const phone = newPhone();
    await verifyPhone((members[0] as Person).userId, phone, false);
    const res = await call("POST", `/orgs/${orgId}/invites`, owner.jar, { phone });
    expect(res.statusCode).toBe(201);
  });

  it(`stops at ${MAX_PENDING_INVITES_PER_ORG} pending invitations (QUOTA_EXCEEDED pending_invites_limit)`, async () => {
    const { owner, orgId } = await fixture();
    for (let i = 0; i < MAX_PENDING_INVITES_PER_ORG; i++) {
      await insertInvite({ orgId, email: newEmail() });
    }
    // Accepted and expired invitations do not count.
    await insertInvite({ orgId, email: newEmail(), acceptedAt: new Date() });
    await insertInvite({ orgId, email: newEmail(), expiresAt: new Date(Date.now() - 1000) });

    const res = await call("POST", `/orgs/${orgId}/invites`, owner.jar, { email: newEmail() });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: "QUOTA_EXCEEDED",
      details: { reason: "pending_invites_limit" },
    });
  });

  it(`allows ${MAX_INVITES_PER_USER_PER_DAY} invitations a day per inviter, then RATE_LIMITED`, async () => {
    const owner = await admin();
    const orgs = [
      await makeOrg([{ person: owner, role: "org_admin" }]),
      await makeOrg([{ person: owner, role: "org_admin" }]),
    ];
    for (let i = 0; i < MAX_INVITES_PER_USER_PER_DAY; i++) {
      const res = await call("POST", `/orgs/${orgs[i % 2]}/invites`, owner.jar, {
        email: newEmail(),
      });
      expect(res.statusCode).toBe(201);
    }
    const res = await call("POST", `/orgs/${orgs[0]}/invites`, owner.jar, { email: newEmail() });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("answers 403 to a plain member and hides the organization from non-members", async () => {
    const { owner, members, orgId } = await fixture(1);
    const forbidden = await call("POST", `/orgs/${orgId}/invites`, (members[0] as Person).jar, {
      email: newEmail(),
    });
    expect(forbidden.statusCode).toBe(403);

    const to = newEmail();
    await wrongOwnerIsHidden({
      owner: () => call("POST", `/orgs/${orgId}/invites`, owner.jar, { email: to }),
      intruder: () => call("POST", `/orgs/${orgId}/invites`, outsider.jar, { email: newEmail() }),
      stillThere: async () =>
        (await handle.db.select().from(organizationInvites)).every((row) => row.orgId !== orgId),
    });
  });

  it.each([
    ["no target", {}],
    ["a malformed email", { email: "not-an-email" }],
    ["a malformed phone", { phone: "01012345678" }],
    ["an unknown role", { email: "x@example.com", role: "owner" }],
  ])("rejects %s", async (_label, body) => {
    const { owner, orgId } = await fixture();
    const res = await call("POST", `/orgs/${orgId}/invites`, owner.jar, body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("DELETE /orgs/:id/invites/:inviteId", () => {
  it("revokes a pending invitation and audits it", async () => {
    const { owner, orgId } = await fixture();
    const invite = await insertInvite({ orgId, email: newEmail() });
    const res = await call("DELETE", `/orgs/${orgId}/invites/${invite.id}`, owner.jar);
    expect(res.statusCode).toBe(204);
    expect(await inviteRow(invite.id)).toBeNull();
    const [row] = await auditRows("org.invite_revoke", invite.id);
    expect(row).toMatchObject({ actorId: owner.userId, targetType: "org_invite" });
  });

  it("answers NOT_FOUND for an accepted, an expired or another organization's invitation", async () => {
    const { owner, orgId } = await fixture();
    const other = await fixture();
    const accepted = await insertInvite({ orgId, email: newEmail(), acceptedAt: new Date() });
    const expired = await insertInvite({
      orgId,
      email: newEmail(),
      expiresAt: new Date(Date.now() - 1000),
    });
    const foreign = await insertInvite({ orgId: other.orgId, email: newEmail() });

    for (const id of [accepted.id, expired.id, foreign.id, randomUUID()]) {
      const res = await call("DELETE", `/orgs/${orgId}/invites/${id}`, owner.jar);
      expect(res.statusCode).toBe(404);
    }
    expect(await inviteRow(foreign.id)).not.toBeNull();
    expect(await inviteRow(accepted.id)).not.toBeNull();
  });

  it("answers 403 to a plain member and hides the organization from non-members", async () => {
    const { owner, members, orgId } = await fixture(1);
    const invite = await insertInvite({ orgId, email: newEmail() });
    const forbidden = await call(
      "DELETE",
      `/orgs/${orgId}/invites/${invite.id}`,
      (members[0] as Person).jar,
    );
    expect(forbidden.statusCode).toBe(403);
    await wrongOwnerIsHidden({
      owner: () => call("DELETE", `/orgs/${orgId}/invites/${invite.id}`, owner.jar),
      intruder: () => call("DELETE", `/orgs/${orgId}/invites/${invite.id}`, outsider.jar),
      stillThere: async () => (await inviteRow(invite.id)) !== null,
    });
  });

  it("rejects ids that are not uuids", async () => {
    const { owner, orgId } = await fixture();
    const res = await call("DELETE", `/orgs/${orgId}/invites/nope`, owner.jar);
    expect(res.statusCode).toBe(400);
  });
});

// --- invitations of the caller ---

describe("GET /me/invites", () => {
  it("shows an invitation addressed to my verified email", async () => {
    const { orgId } = await fixture();
    const invitee = await harness.signedInUser();
    const mine = await insertInvite({ orgId, email: invitee.email, role: "org_admin" });
    await insertInvite({ orgId, email: newEmail() });

    const res = await call("GET", "/me/invites", invitee.jar);
    expect(res.statusCode).toBe(200);
    const list = myInviteListResponseSchema.parse(res.json());
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: mine.id,
      orgId,
      orgName: "عيادة النور",
      orgType: "clinic",
      role: "org_admin",
    });
    expect(res.body).not.toContain(invitee.email);
  });

  it("shows an invitation addressed to my phone only once the phone is verified", async () => {
    const { orgId } = await fixture();
    const invitee = await harness.signedInUser();
    const phone = newPhone();
    await insertInvite({ orgId, phone });

    await verifyPhone(invitee.userId, phone, false);
    expect(
      myInviteListResponseSchema.parse((await call("GET", "/me/invites", invitee.jar)).json())
        .items,
    ).toEqual([]);

    await verifyPhone(invitee.userId, phone, true);
    expect(
      myInviteListResponseSchema.parse((await call("GET", "/me/invites", invitee.jar)).json())
        .items,
    ).toHaveLength(1);
  });

  it("does not show an invitation for an unverified email or a placeholder email", async () => {
    const { orgId } = await fixture();
    const unverified = await harness.signedInUser();
    await insertInvite({ orgId, email: unverified.email });
    await handle.db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, unverified.userId));
    expect(
      myInviteListResponseSchema.parse((await call("GET", "/me/invites", unverified.jar)).json())
        .items,
    ).toEqual([]);

    const phoneOnly = await harness.signedInUser();
    const placeholder = `p${randomBytes(6).toString("hex")}@phone.wasfa.invalid`;
    await handle.db
      .update(users)
      .set({ email: placeholder, emailVerified: true })
      .where(eq(users.id, phoneOnly.userId));
    await insertInvite({ orgId, email: placeholder });
    expect(
      myInviteListResponseSchema.parse((await call("GET", "/me/invites", phoneOnly.jar)).json())
        .items,
    ).toEqual([]);
  });

  it("hides accepted, expired and other people's invitations", async () => {
    const { orgId } = await fixture();
    const invitee = await harness.signedInUser();
    await insertInvite({ orgId, email: invitee.email, acceptedAt: new Date() });
    await insertInvite({ orgId, email: invitee.email, expiresAt: new Date(Date.now() - 1000) });
    const res = await call("GET", "/me/invites", invitee.jar);
    expect(myInviteListResponseSchema.parse(res.json()).items).toEqual([]);
    expect(
      myInviteListResponseSchema.parse((await call("GET", "/me/invites", outsider.jar)).json())
        .items,
    ).toEqual([]);
  });
});

describe("POST /me/invites/:id/accept", () => {
  it("joins the organization with the invited role, single use, busts access and audits it", async () => {
    const { owner, orgId } = await fixture();
    const invitee = await harness.signedInUser();
    const invite = await insertInvite({
      orgId,
      email: invitee.email,
      role: "org_admin",
      invitedBy: owner.userId,
    });
    // Prime the invitee's cached access (no organizations yet).
    await call("GET", "/orgs", invitee.jar);
    const [before] = await rbacCacheKeys(invitee.userId);
    expect(JSON.parse((await redis.get(before ?? "")) ?? "{}")).toMatchObject({ orgIds: [] });

    const res = await call("POST", `/me/invites/${invite.id}/accept`, invitee.jar);
    expect(res.statusCode).toBe(200);
    expect(orgResponseSchema.parse(res.json())).toMatchObject({
      id: orgId,
      myRole: "org_admin",
      memberCount: 2,
    });
    const [member] = await handle.db
      .select()
      .from(organizationMembers)
      .where(
        and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, invitee.userId)),
      );
    expect(member).toMatchObject({ role: "org_admin", invitedBy: owner.userId });
    expect((await inviteRow(invite.id))?.acceptedAt).toBeInstanceOf(Date);

    // The cached access was dropped and the next request resolves the new organization.
    expect(await rbacCacheKeys(invitee.userId)).toHaveLength(0);
    const listed = orgListResponseSchema.parse((await call("GET", "/orgs", invitee.jar)).json());
    expect(listed.items.map((item) => item.id)).toEqual([orgId]);
    const [after] = await rbacCacheKeys(invitee.userId);
    expect(JSON.parse((await redis.get(after ?? "")) ?? "{}")).toMatchObject({ orgIds: [orgId] });

    const [row] = await auditRows("org.invite_accept", orgId);
    expect(row).toMatchObject({ actorId: invitee.userId, targetType: "org" });
    expect(row?.after).toEqual({ role: "org_admin" });
    expect(JSON.stringify(row)).not.toContain(invitee.email);

    // Single use.
    const again = await call("POST", `/me/invites/${invite.id}/accept`, invitee.jar);
    expect(again.statusCode).toBe(404);
  });

  it("works for a phone invitation once the phone is verified", async () => {
    const { orgId } = await fixture();
    const invitee = await harness.signedInUser();
    const phone = newPhone();
    const invite = await insertInvite({ orgId, phone });

    await verifyPhone(invitee.userId, phone, false);
    expect((await call("POST", `/me/invites/${invite.id}/accept`, invitee.jar)).statusCode).toBe(
      404,
    );
    await verifyPhone(invitee.userId, phone, true);
    const res = await call("POST", `/me/invites/${invite.id}/accept`, invitee.jar);
    expect(res.statusCode).toBe(200);
    expect(await memberRole(orgId, invitee.userId)).toBe("org_member");
  });

  it("answers NOT_FOUND for someone else's, an expired, an accepted or an unknown invitation", async () => {
    const { orgId } = await fixture();
    const invitee = await harness.signedInUser();
    const forSomeoneElse = await insertInvite({ orgId, email: newEmail() });
    const forInvitee = await insertInvite({ orgId, email: invitee.email });
    const expired = await insertInvite({
      orgId,
      email: invitee.email,
      expiresAt: new Date(Date.now() - 1000),
    });
    const accepted = await insertInvite({ orgId, email: invitee.email, acceptedAt: new Date() });

    for (const id of [forSomeoneElse.id, expired.id, accepted.id, randomUUID()]) {
      const res = await call("POST", `/me/invites/${id}/accept`, invitee.jar);
      expect(res.statusCode).toBe(404);
    }
    // A stranger cannot use an invitation that is addressed to the invitee.
    const stolen = await call("POST", `/me/invites/${forInvitee.id}/accept`, outsider.jar);
    expect(stolen.statusCode).toBe(404);
    expect(await memberRole(orgId, invitee.userId)).toBeNull();
    expect(await memberRole(orgId, outsider.userId)).toBeNull();
    expect((await inviteRow(forInvitee.id))?.acceptedAt).toBeNull();
  });

  it("refuses with CONFLICT already_member and keeps the invitation pending", async () => {
    const { members, orgId } = await fixture(1);
    const member = members[0] as Person;
    const invite = await insertInvite({ orgId, email: member.email, role: "org_admin" });
    const res = await call("POST", `/me/invites/${invite.id}/accept`, member.jar);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "CONFLICT", details: { reason: "already_member" } });
    expect(await memberRole(orgId, member.userId)).toBe("org_member");
    expect((await inviteRow(invite.id))?.acceptedAt).toBeNull();
  });

  it("lets only one of two simultaneous accepts succeed", async () => {
    const { orgId } = await fixture();
    const invitee = await harness.signedInUser();
    const invite = await insertInvite({ orgId, email: invitee.email });
    const results = await Promise.all([
      call("POST", `/me/invites/${invite.id}/accept`, invitee.jar),
      call("POST", `/me/invites/${invite.id}/accept`, invitee.jar),
    ]);
    expect(results.map((res) => res.statusCode).sort()).toEqual([200, 404]);
  });

  it("rejects an id that is not a uuid", async () => {
    const res = await call("POST", "/me/invites/nope/accept", outsider.jar);
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /invites/accept", () => {
  it("accepts the token from the emailed link, once", async () => {
    const { orgId, owner } = await fixture();
    const invitee = await harness.signedInUser();
    const created = await call("POST", `/orgs/${orgId}/invites`, owner.jar, {
      email: invitee.email,
    });
    expect(created.statusCode).toBe(201);
    const { token } = await inviteLinkFor(invitee.email);

    // Somebody who got hold of the link but is not the invitee gets nothing.
    const stolen = await call("POST", "/invites/accept", outsider.jar, { token });
    expect(stolen.statusCode).toBe(404);
    expect(await memberRole(orgId, outsider.userId)).toBeNull();

    const res = await call("POST", "/invites/accept", invitee.jar, { token });
    expect(res.statusCode).toBe(200);
    expect(orgResponseSchema.parse(res.json())).toMatchObject({ id: orgId, myRole: "org_member" });
    expect(await memberRole(orgId, invitee.userId)).toBe("org_member");
    const [row] = await auditRows("org.invite_accept", orgId);
    expect(row?.actorId).toBe(invitee.userId);

    const again = await call("POST", "/invites/accept", invitee.jar, { token });
    expect(again.statusCode).toBe(404);
  });

  it("answers NOT_FOUND for an unknown, an expired or a someone-else's token", async () => {
    const { orgId } = await fixture();
    const invitee = await harness.signedInUser();
    const expired = await insertInvite({
      orgId,
      email: invitee.email,
      expiresAt: new Date(Date.now() - 1000),
    });
    const foreign = await insertInvite({ orgId, email: newEmail() });
    for (const token of [randomBytes(32).toString("base64url"), expired.token, foreign.token]) {
      const res = await call("POST", "/invites/accept", invitee.jar, { token });
      expect(res.statusCode).toBe(404);
    }
    expect(await memberRole(orgId, invitee.userId)).toBeNull();
  });

  it.each([
    ["a token of the wrong length", { token: "abc" }],
    ["a token with forbidden characters", { token: `${"a".repeat(42)}!` }],
    ["no token", {}],
  ])("rejects %s", async (_label, body) => {
    const res = await call("POST", "/invites/accept", outsider.jar, body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

// --- rate limits ---

describe("rate limits", () => {
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const cases: [string, Method, string, number, Record<string, unknown>?][] = [
    ["GET /orgs", "GET", "/orgs", 60],
    ["GET /orgs/:id", "GET", `/orgs/${id}`, 60],
    ["PATCH /orgs/:id", "PATCH", `/orgs/${id}`, 20, { name: "Name" }],
    ["GET /orgs/:id/members", "GET", `/orgs/${id}/members`, 60],
    [
      "PATCH /orgs/:id/members/:userId",
      "PATCH",
      `/orgs/${id}/members/${id}`,
      20,
      { role: "org_member" },
    ],
    ["DELETE /orgs/:id/members/:userId", "DELETE", `/orgs/${id}/members/${id}`, 20],
    ["POST /orgs/:id/leave", "POST", `/orgs/${id}/leave`, 10],
    ["GET /orgs/:id/invites", "GET", `/orgs/${id}/invites`, 60],
    ["POST /orgs/:id/invites", "POST", `/orgs/${id}/invites`, 10, { email: "a@example.com" }],
    ["DELETE /orgs/:id/invites/:inviteId", "DELETE", `/orgs/${id}/invites/${id}`, 20],
    ["GET /me/invites", "GET", "/me/invites", 30],
    ["POST /me/invites/:id/accept", "POST", `/me/invites/${id}/accept`, 10],
    ["POST /invites/accept", "POST", "/invites/accept", 10, { token }],
  ];

  it.each(cases)(
    "%s answers 429 on the request after its limit",
    async (_label, method, url, max, body) => {
      const ip = randomIp();
      const statuses: number[] = [];
      for (let i = 0; i <= max; i++) {
        statuses.push((await call(method, url, outsider.jar, body, ip)).statusCode);
      }
      expect(statuses.slice(0, max)).not.toContain(429);
      expect(statuses[max]).toBe(429);
    },
    60_000,
  );
});
