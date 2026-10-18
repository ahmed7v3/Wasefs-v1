import { randomUUID } from "node:crypto";

import {
  auditLogs,
  contactMessages,
  deals,
  organizationJoinLinks,
  organizationMembers,
  outbox,
  users,
} from "@wasfa/db";
import {
  joinAcceptResponseSchema,
  joinLandingSchema,
  joinLinkItemSchema,
  type JoinLinkItem,
} from "@wasfa/shared/schemas/org";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { SEAT_LIMIT_SOURCE, type SeatLimitSource } from "../src/orgs/seats/seat-limit.js";

import { AdminTestContext, type Person } from "./support/admin-context.js";
import { expectRateLimited, insertOrg } from "./support/identity-fixtures.js";

/*
 * Organization join links (Task 3.9): who may create them, the public landing, joining with
 * verification, the approval flow, limits (uses, expiry, seats) and the institution lead form.
 */

const ctx = new AdminTestContext();

beforeAll(async () => {
  await ctx.start();
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

let slugCounter = 0;
let phoneCounter = 0;
const slug = () => `join-${String(++slugCounter)}-${randomUUID().slice(0, 6)}`;

interface Fixture {
  orgId: string;
  admin: Person;
  member: Person;
}

async function makeOrg(): Promise<Fixture> {
  const admin = await ctx.harness.signedInUser();
  const member = await ctx.harness.signedInUser();
  const orgId = await insertOrg(ctx.owner.db, {
    createdBy: admin.userId,
    name: "صيدلية النور",
    members: [
      { userId: admin.userId, role: "org_admin" },
      { userId: member.userId, role: "org_member" },
    ],
  });
  return { orgId, admin, member };
}

/** A signed-in user whose email is verified (sign-up) and, optionally, whose phone is too. */
async function joiner(verifiedPhone = true): Promise<Person> {
  const person = await ctx.harness.signedInUser();
  if (verifiedPhone) {
    await ctx.owner.db
      .update(users)
      .set({
        phone: `+2011${String(10_000_000 + ++phoneCounter + (Date.now() % 80_000_000))}`,
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
      })
      .where(eq(users.id, person.userId));
  }
  return person;
}

async function createLink(
  fixture: Fixture,
  body: Record<string, unknown> = {},
): Promise<JoinLinkItem> {
  const res = await ctx.harness.call("POST", `/orgs/${fixture.orgId}/join-links`, {
    jar: fixture.admin.jar,
    body: { slug: slug(), ...body },
  });
  expect(res.statusCode, res.body).toBe(201);
  return joinLinkItemSchema.parse(res.json());
}

const accept = (person: Person, linkSlug: string) =>
  ctx.harness.call("POST", `/join/${linkSlug}/accept`, { jar: person.jar });

async function membership(orgId: string, userId: string) {
  const [row] = await ctx.owner.db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)));
  return row ?? null;
}

async function usedCount(linkId: string): Promise<number> {
  const [row] = await ctx.owner.db
    .select({ used: organizationJoinLinks.usedCount })
    .from(organizationJoinLinks)
    .where(eq(organizationJoinLinks.id, linkId));
  return row?.used ?? -1;
}

describe("creating and disabling links", () => {
  it("an org admin creates, lists and disables a link; the creation is audited", async () => {
    const fixture = await makeOrg();
    const link = await createLink(fixture, { maxUses: 5, role: "org_member" });
    expect(link).toMatchObject({
      active: true,
      usedCount: 0,
      maxUses: 5,
      approval: "auto_approve",
    });

    const list = await ctx.harness.call("GET", `/orgs/${fixture.orgId}/join-links`, {
      jar: fixture.admin.jar,
    });
    expect(list.json()).toMatchObject({ items: [{ id: link.id }] });

    const off = await ctx.harness.call(
      "POST",
      `/orgs/${fixture.orgId}/join-links/${link.id}/disable`,
      { jar: fixture.admin.jar },
    );
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({ active: false });

    const rows = await ctx.owner.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "org.join_link_create"), eq(auditLogs.targetId, link.id)));
    expect(rows).toHaveLength(1);
  });

  it("a plain member cannot create or disable (403), an outsider sees NOT_FOUND, a taken slug conflicts", async () => {
    const fixture = await makeOrg();
    const stranger = await ctx.harness.signedInUser();
    const body = { slug: slug() };
    const asMember = await ctx.harness.call("POST", `/orgs/${fixture.orgId}/join-links`, {
      jar: fixture.member.jar,
      body,
    });
    expect(asMember.statusCode).toBe(403);
    const asStranger = await ctx.harness.call("POST", `/orgs/${fixture.orgId}/join-links`, {
      jar: stranger.jar,
      body,
    });
    expect(asStranger.statusCode).toBe(404);
    expect(
      await ctx.owner.db
        .select()
        .from(organizationJoinLinks)
        .where(eq(organizationJoinLinks.orgId, fixture.orgId)),
    ).toHaveLength(0);

    const link = await createLink(fixture);
    const twice = await ctx.harness.call("POST", `/orgs/${fixture.orgId}/join-links`, {
      jar: fixture.admin.jar,
      body: { slug: link.slug },
    });
    expect(twice.statusCode).toBe(409);
    expect(twice.json()).toMatchObject({ details: { reason: "slug_taken" } });

    const disableAsMember = await ctx.harness.call(
      "POST",
      `/orgs/${fixture.orgId}/join-links/${link.id}/disable`,
      { jar: fixture.member.jar },
    );
    expect(disableAsMember.statusCode).toBe(403);
    const otherOrg = await makeOrg();
    const wrongOrg = await ctx.harness.call(
      "POST",
      `/orgs/${otherOrg.orgId}/join-links/${link.id}/disable`,
      { jar: otherOrg.admin.jar },
    );
    expect(wrongOrg.statusCode).toBe(404);

    const badSlug = await ctx.harness.call("POST", `/orgs/${fixture.orgId}/join-links`, {
      jar: fixture.admin.jar,
      body: { slug: "x" },
    });
    expect(badSlug.statusCode).toBe(400);
  });

  it("platform admins create and disable links on any organization, audited, with the right permissions", async () => {
    const fixture = await makeOrg();
    const admin = await ctx.admin("super_admin");
    const without = await ctx.admin(await ctx.roleLacking("orgs.write"));
    const newSlug = slug();

    const denied = await ctx.harness.call("POST", `/admin/orgs/${fixture.orgId}/join-links`, {
      jar: without.jar,
      body: { slug: newSlug },
    });
    expect(denied.statusCode).toBe(403);

    const created = await ctx.harness.call("POST", `/admin/orgs/${fixture.orgId}/join-links`, {
      jar: admin.jar,
      body: { slug: newSlug, approval: "requires_approval" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const link = joinLinkItemSchema.parse(created.json());
    expect(link.approval).toBe("requires_approval");
    expect((await ctx.auditRowsFor("admin.org.join_link_create", link.id)).length).toBe(1);

    const list = await ctx.harness.call("GET", `/admin/orgs/${fixture.orgId}/join-links`, {
      jar: admin.jar,
    });
    expect(list.json()).toMatchObject({ items: [{ id: link.id }] });
    const off = await ctx.harness.call(
      "POST",
      `/admin/orgs/${fixture.orgId}/join-links/${link.id}/disable`,
      { jar: admin.jar },
    );
    expect(off.json()).toMatchObject({ active: false });
    expect((await ctx.auditRowsFor("admin.org.join_link_disable", link.id)).length).toBe(1);

    const missing = await ctx.harness.call("GET", `/admin/orgs/${randomUUID()}/join-links`, {
      jar: admin.jar,
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe("the public landing", () => {
  it("shows the organization, and answers every unusable link with the same body", async () => {
    const fixture = await makeOrg();
    const live = await createLink(fixture);
    const ok = await ctx.harness.call("GET", `/join/${live.slug}`);
    expect(ok.statusCode).toBe(200);
    expect(joinLandingSchema.parse(ok.json())).toEqual({
      valid: true,
      org: { name: "صيدلية النور" },
      benefit: null,
      approval: "auto_approve",
    });

    const disabled = await createLink(fixture);
    await ctx.harness.call("POST", `/orgs/${fixture.orgId}/join-links/${disabled.id}/disable`, {
      jar: fixture.admin.jar,
    });
    const expired = await createLink(fixture);
    await ctx.owner.db
      .update(organizationJoinLinks)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(organizationJoinLinks.id, expired.id));
    const usedUp = await createLink(fixture, { maxUses: 1 });
    expect((await accept(await joiner(), usedUp.slug)).statusCode).toBe(200);

    for (const dead of [disabled.slug, expired.slug, usedUp.slug, `nope-${slug()}`, "!!"]) {
      const res = await ctx.harness.call("GET", `/join/${dead}`);
      expect(res.statusCode, dead).toBe(200);
      expect(res.json(), dead).toEqual({ valid: false });
    }
  });

  it("names the deal of the link when it is active", async () => {
    const fixture = await makeOrg();
    const [deal] = await ctx.owner.db
      .insert(deals)
      .values({ name: "سعر أعضاء صيدلية النور", status: "active", terms: {} })
      .returning({ id: deals.id });
    const link = await createLink(fixture, { dealId: deal?.id });
    const res = await ctx.harness.call("GET", `/join/${link.slug}`);
    expect(res.json()).toMatchObject({
      valid: true,
      benefit: { dealName: "سعر أعضاء صيدلية النور" },
    });
    const unknownDeal = await ctx.harness.call("POST", `/orgs/${fixture.orgId}/join-links`, {
      jar: fixture.admin.jar,
      body: { slug: slug(), dealId: randomUUID() },
    });
    expect(unknownDeal.statusCode).toBe(400);
  });

  it("is rate limited per IP", async () => {
    await expectRateLimited(ctx.harness, { method: "GET", url: `/join/${slug()}`, max: 60 });
  });
});

describe("joining", () => {
  it("needs a verified email and phone, then makes the person a member through the link", async () => {
    const fixture = await makeOrg();
    const link = await createLink(fixture, { role: "org_member" });

    const anonymous = await ctx.harness.call("POST", `/join/${link.slug}/accept`);
    expect(anonymous.statusCode).toBe(401);

    const unverified = await joiner(false);
    const refused = await accept(unverified, link.slug);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ details: { reason: "verification_required" } });
    expect(await membership(fixture.orgId, unverified.userId)).toBeNull();

    const person = await joiner();
    const res = await accept(person, link.slug);
    expect(res.statusCode, res.body).toBe(200);
    expect(joinAcceptResponseSchema.parse(res.json())).toEqual({
      outcome: "joined",
      orgId: fixture.orgId,
    });
    expect(await membership(fixture.orgId, person.userId)).toMatchObject({
      role: "org_member",
      status: "active",
      joinedViaLinkId: link.id,
    });
    expect(await usedCount(link.id)).toBe(1);

    // They appear in the org's member list and may act in the organization.
    const members = await ctx.harness.call("GET", `/orgs/${fixture.orgId}/members`, {
      jar: fixture.admin.jar,
    });
    expect(JSON.stringify(members.json())).toContain(person.userId);
    const credits = await ctx.harness.call("GET", `/me/credits?orgId=${fixture.orgId}`, {
      jar: person.jar,
    });
    expect(credits.statusCode).toBe(200);

    // The rewards engine is told, once.
    const events = await ctx.owner.db
      .select()
      .from(outbox)
      .where(eq(outbox.idempotencyKey, `orgs.member_joined:${fixture.orgId}:${person.userId}`));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      topic: "orgs.member_joined",
      payload: { orgId: fixture.orgId, userId: person.userId, linkId: link.id },
    });

    // Doing it again is a success that spends no use.
    const again = await accept(person, link.slug);
    expect(again.json()).toEqual({ outcome: "already_member", orgId: fixture.orgId });
    expect(await usedCount(link.id)).toBe(1);
  });

  it("unusable links refuse with NOT_FOUND", async () => {
    const fixture = await makeOrg();
    const person = await joiner();
    const disabled = await createLink(fixture);
    await ctx.harness.call("POST", `/orgs/${fixture.orgId}/join-links/${disabled.id}/disable`, {
      jar: fixture.admin.jar,
    });
    expect((await accept(person, disabled.slug)).statusCode).toBe(404);
    const expired = await createLink(fixture);
    await ctx.owner.db
      .update(organizationJoinLinks)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(organizationJoinLinks.id, expired.id));
    expect((await accept(person, expired.slug)).statusCode).toBe(404);
    expect((await accept(person, `missing-${slug()}`)).statusCode).toBe(404);
    expect(await membership(fixture.orgId, person.userId)).toBeNull();
  });

  it("parallel accepts of the last use admit exactly one person", async () => {
    const fixture = await makeOrg();
    const link = await createLink(fixture, { maxUses: 1 });
    const people = await Promise.all(Array.from({ length: 5 }, () => joiner()));
    const results = await Promise.all(people.map((person) => accept(person, link.slug)));
    expect(results.filter((res) => res.statusCode === 200)).toHaveLength(1);
    expect(results.filter((res) => res.statusCode === 404)).toHaveLength(4);
    expect(await usedCount(link.id)).toBe(1);
    const members = await ctx.owner.db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.joinedViaLinkId, link.id));
    expect(members).toHaveLength(1);
  });

  it("refuses beyond the seat limit with the upgrade path", async () => {
    const fixture = await makeOrg();
    const link = await createLink(fixture);
    const person = await joiner();
    const source = ctx.app.get<SeatLimitSource>(SEAT_LIMIT_SOURCE);
    const spy = vi.spyOn(source, "limitFor").mockResolvedValue(2);
    try {
      const res = await accept(person, link.slug);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        details: { reason: "seat_limit", upgradePath: `/pricing?org=${fixture.orgId}` },
      });
      expect(await membership(fixture.orgId, person.userId)).toBeNull();
      expect(await usedCount(link.id)).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("requires_approval", () => {
  it("files a request that grants nothing until an org admin approves it", async () => {
    const fixture = await makeOrg();
    const link = await createLink(fixture, { approval: "requires_approval" });
    const person = await joiner();

    const res = await accept(person, link.slug);
    expect(res.json()).toEqual({ outcome: "pending", orgId: fixture.orgId });
    expect(await membership(fixture.orgId, person.userId)).toMatchObject({ status: "pending" });
    expect((await accept(person, link.slug)).json()).toEqual({
      outcome: "pending",
      orgId: fixture.orgId,
    });
    expect(await usedCount(link.id)).toBe(1);

    // A pending request is not a member: no access, not listed, no event yet.
    expect(
      (await ctx.harness.call("GET", `/orgs/${fixture.orgId}`, { jar: person.jar })).statusCode,
    ).toBe(404);
    const members = await ctx.harness.call("GET", `/orgs/${fixture.orgId}/members`, {
      jar: fixture.admin.jar,
    });
    expect(JSON.stringify(members.json())).not.toContain(person.userId);
    const dashboard = await ctx.harness.call("GET", `/orgs/${fixture.orgId}/dashboard`, {
      jar: fixture.admin.jar,
    });
    expect(dashboard.json()).toMatchObject({
      pendingMembers: [{ userId: person.userId }],
      seats: { used: 2 },
    });
    expect(
      await ctx.owner.db
        .select()
        .from(outbox)
        .where(eq(outbox.idempotencyKey, `orgs.member_joined:${fixture.orgId}:${person.userId}`)),
    ).toHaveLength(0);

    const url = `/orgs/${fixture.orgId}/members/${person.userId}/approve`;
    expect((await ctx.harness.call("POST", url, { jar: fixture.member.jar })).statusCode).toBe(403);
    expect((await ctx.harness.call("POST", url, { jar: person.jar })).statusCode).toBe(404);
    const approved = await ctx.harness.call("POST", url, { jar: fixture.admin.jar });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(await membership(fixture.orgId, person.userId)).toMatchObject({ status: "active" });
    expect(
      (await ctx.harness.call("GET", `/orgs/${fixture.orgId}`, { jar: person.jar })).statusCode,
    ).toBe(200);
    expect(
      await ctx.owner.db
        .select()
        .from(outbox)
        .where(eq(outbox.idempotencyKey, `orgs.member_joined:${fixture.orgId}:${person.userId}`)),
    ).toHaveLength(1);
    // Nothing left to approve.
    expect((await ctx.harness.call("POST", url, { jar: fixture.admin.jar })).statusCode).toBe(404);
  });

  it("rejecting removes the request and never touches a member", async () => {
    const fixture = await makeOrg();
    const link = await createLink(fixture, { approval: "requires_approval" });
    const person = await joiner();
    await accept(person, link.slug);

    const url = `/orgs/${fixture.orgId}/members/${person.userId}/reject`;
    expect((await ctx.harness.call("POST", url, { jar: fixture.member.jar })).statusCode).toBe(403);
    expect((await ctx.harness.call("POST", url, { jar: fixture.admin.jar })).statusCode).toBe(204);
    expect(await membership(fixture.orgId, person.userId)).toBeNull();

    const activeUrl = `/orgs/${fixture.orgId}/members/${fixture.member.userId}/reject`;
    expect((await ctx.harness.call("POST", activeUrl, { jar: fixture.admin.jar })).statusCode).toBe(
      404,
    );
    expect(await membership(fixture.orgId, fixture.member.userId)).toMatchObject({
      status: "active",
    });
  });

  it("approval is refused when no seat is left", async () => {
    const fixture = await makeOrg();
    const link = await createLink(fixture, { approval: "requires_approval" });
    const person = await joiner();
    await accept(person, link.slug);
    const source = ctx.app.get<SeatLimitSource>(SEAT_LIMIT_SOURCE);
    const spy = vi.spyOn(source, "limitFor").mockResolvedValue(2);
    try {
      const res = await ctx.harness.call(
        "POST",
        `/orgs/${fixture.orgId}/members/${person.userId}/approve`,
        { jar: fixture.admin.jar },
      );
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ details: { reason: "seat_limit" } });
      expect(await membership(fixture.orgId, person.userId)).toMatchObject({ status: "pending" });
    } finally {
      spy.mockRestore();
    }
  });

  it("a join link cannot carry the org_admin role", async () => {
    const fixture = await makeOrg();
    const res = await ctx.harness.call("POST", `/orgs/${fixture.orgId}/join-links`, {
      jar: fixture.admin.jar,
      body: { slug: slug(), role: "org_admin" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("a pending request does not count in the member count and grants nothing", async () => {
    const fixture = await makeOrg();
    const link = await createLink(fixture, { approval: "requires_approval" });
    const person = await joiner();
    await accept(person, link.slug);
    const org = await ctx.harness.call("GET", `/orgs/${fixture.orgId}`, { jar: fixture.admin.jar });
    expect(org.json()).toMatchObject({ memberCount: 2 });
    // And it grants no admin rights.
    const create = await ctx.harness.call("POST", `/orgs/${fixture.orgId}/join-links`, {
      jar: person.jar,
      body: { slug: slug() },
    });
    expect(create.statusCode).toBe(404);
  });
});

describe("institution leads", () => {
  const lead = (overrides: Record<string, unknown> = {}) => ({
    orgName: "مستشفى الأمل",
    contactName: "Dr. Salma",
    phone: "+201012345678",
    email: `lead-${randomUUID().slice(0, 8)}@example.com`,
    seats: 40,
    message: "We need a plan for 40 doctors.",
    ...overrides,
  });

  it("stores the lead as a message and opens a draft deal for it", async () => {
    const body = lead();
    const res = await ctx.harness.call("POST", "/institutions/leads", { body });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toEqual({ received: true });

    const [message] = await ctx.owner.db
      .select()
      .from(contactMessages)
      .where(eq(contactMessages.email, body.email));
    expect(message).toMatchObject({
      topic: "institution_lead",
      name: "Dr. Salma",
      phone: "+201012345678",
      status: "new",
    });
    expect(message?.message).toContain("Seats: 40");
    expect(message?.message).toContain("مستشفى الأمل");
    const [deal] = await ctx.owner.db
      .select()
      .from(deals)
      .where(eq(deals.notes, `lead:${message?.id ?? ""}`));
    expect(deal).toMatchObject({ name: "Lead: مستشفى الأمل", status: "draft", terms: {} });
  });

  it("validates the form", async () => {
    for (const bad of [
      lead({ seats: 0 }),
      lead({ phone: "0101" }),
      lead({ email: "nope" }),
      lead({ message: "x".repeat(2_001) }),
      lead({ orgName: "" }),
    ]) {
      const res = await ctx.harness.call("POST", "/institutions/leads", { body: bad });
      expect(res.statusCode).toBe(400);
    }
  });

  it("is rate limited per IP", async () => {
    await expectRateLimited(ctx.harness, {
      method: "POST",
      url: "/institutions/leads",
      max: 5,
      body: lead(),
    });
  });
});
