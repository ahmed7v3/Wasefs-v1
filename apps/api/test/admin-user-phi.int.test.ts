import { createHash, randomBytes, randomUUID } from "node:crypto";

import { skillVersion } from "@wasfa/ai";
import {
  aiTaskRoutes,
  chatMessages,
  chats,
  files,
  phiAccessSessions,
  rxAnalyses,
  rxCorrections,
  rxPages,
} from "@wasfa/db";
import { RX_SKILL_NAME } from "@wasfa/shared/rx";
import { RX_SCHEMA_VERSION } from "@wasfa/shared/schemas/rx";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, type Admin } from "./support/admin-context.js";

/*
 * Health data in the user 360 page (ADMIN-CONSOLE-SPEC §8.2, Decision 12): the dedicated
 * permission, a reasoned 30-minute access session of the same admin for the same user, an audit
 * row per open, metadata-only lists and no caching.
 */

const ctx = new AdminTestContext();
const db = () => ctx.owner.db;
let health: Admin;
let otherHealth: Admin;
let support: Admin;
let customerId: string;
let rxId: string;
let chatId: string;
const DRUG = "Augmentin 1g";
const CHAT_TEXT = "my private question about a medicine";

beforeAll(async () => {
  await ctx.start();
  const healthRole = await ctx.customRole(["users.read", "users.read_health", "users.read_chats"]);
  health = await ctx.admin(healthRole);
  otherHealth = await ctx.admin(healthRole);
  support = await ctx.admin("support");
  customerId = (await ctx.harness.signedInUser()).userId;

  const [route] = await db()
    .select({ version: aiTaskRoutes.version })
    .from(aiTaskRoutes)
    .where(
      and(
        eq(aiTaskRoutes.task, "rx_extract"),
        eq(aiTaskRoutes.mode, "balanced"),
        isNull(aiTaskRoutes.planId),
      ),
    );
  const fileId = randomUUID();
  await db()
    .insert(files)
    .values({
      id: fileId,
      ownerUserId: customerId,
      createdBy: customerId,
      purpose: "rx_page",
      r2Key: `test/${fileId}.jpg`,
      mime: "image/jpeg",
      bytes: 5_000,
      sha256: randomBytes(32).toString("hex"),
      status: "processed",
    });
  rxId = randomUUID();
  await db()
    .insert(rxAnalyses)
    .values({
      id: rxId,
      ownerUserId: customerId,
      createdBy: customerId,
      status: "done",
      mode: "balanced",
      skillVersion: skillVersion(RX_SKILL_NAME),
      routeVersion: route?.version ?? 1,
      inputSha256: createHash("sha256").update(rxId).digest("hex"),
      finishedAt: new Date(),
      result: {
        schemaVersion: RX_SCHEMA_VERSION,
        items: [
          {
            rawText: DRUG,
            name: DRUG,
            matchedDrugId: null,
            matchScore: null,
            activeIngredients: [],
            strength: null,
            form: null,
            dose: null,
            frequency: null,
            duration: null,
            route: null,
            notes: null,
            confidence: 0.6,
            badge: "medium",
            verified: "not_needed",
            box_2d: null,
            page: 0,
          },
        ],
        date: null,
        prescriberLegible: true,
        findings: [],
        unreadableRegions: [],
      },
    });
  await db().insert(rxPages).values({ analysisId: rxId, pageNo: 1, fileId });
  const [chat] = await db()
    .insert(chats)
    .values({ ownerUserId: customerId, userId: customerId, title: "Private title" })
    .returning({ id: chats.id });
  if (!chat) throw new Error("chat missing");
  chatId = chat.id;
  await db().insert(chatMessages).values({ chatId, role: "user", content: CHAT_TEXT });
}, 240_000);

afterAll(async () => {
  await ctx.stop();
});

const call = (who: Admin, method: "GET" | "POST", url: string, body?: Record<string, unknown>) =>
  ctx.harness.call(method, url, { jar: who.jar, ...(body ? { body } : {}) });

describe("prescriptions", () => {
  it("lists metadata only: no drug name, no text, no caching", async () => {
    const res = await call(health, "GET", `/admin/users/${customerId}/prescriptions`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.body).not.toContain(DRUG);
    expect(res.json().items[0]).toMatchObject({ id: rxId, itemCount: 1, mediumConfidence: 1 });
  });

  it("opens a result only inside this admin's own access session, and audits every open", async () => {
    const refused = await call(health, "GET", `/admin/users/${customerId}/prescriptions/${rxId}`);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().details).toMatchObject({ reason: "phi_session_required" });

    const started = await call(health, "POST", `/admin/users/${customerId}/phi-sessions`, {
      reason: "support_request",
      note: "ticket 42",
    });
    expect(started.statusCode, started.body).toBe(201);
    expect(await ctx.auditRowsFor("phi.session_started", customerId)).toHaveLength(1);

    const opened = await call(health, "GET", `/admin/users/${customerId}/prescriptions/${rxId}`);
    expect(opened.statusCode, opened.body).toBe(200);
    expect(opened.headers["cache-control"]).toContain("no-store");
    expect(opened.body).toContain(DRUG);
    await call(health, "GET", `/admin/users/${customerId}/prescriptions/${rxId}`);
    const views = await ctx.auditRowsFor("phi.view", customerId);
    expect(views).toHaveLength(2);
    expect(views[0]?.after).toMatchObject({
      recordType: "rx_analysis",
      recordId: rxId,
      reason: "support_request",
    });

    // Another admin with the same permission has no session of their own: refused.
    expect(
      (await call(otherHealth, "GET", `/admin/users/${customerId}/prescriptions/${rxId}`))
        .statusCode,
    ).toBe(403);
  });

  it("returns full details with corrections and timings, even when the user did not share it", async () => {
    const startedAt = new Date(Date.now() - 5_000);
    const finishedAt = new Date(startedAt.getTime() + 3_000);
    await db()
      .update(rxAnalyses)
      .set({ startedAt, finishedAt, patientInitials: "A.B." })
      .where(eq(rxAnalyses.id, rxId));
    await db()
      .insert(rxCorrections)
      .values({
        analysisId: rxId,
        itemIndex: 0,
        field: "dose",
        before: "1",
        after: "2",
        userId: customerId,
      });
    const [row] = await db()
      .select({ shared: rxAnalyses.shareForReview })
      .from(rxAnalyses)
      .where(eq(rxAnalyses.id, rxId));
    expect(row?.shared).toBe(false);

    const opened = await call(health, "GET", `/admin/users/${customerId}/prescriptions/${rxId}`);
    expect(opened.statusCode, opened.body).toBe(200);
    const body = opened.json();
    expect(body.view.id).toBe(rxId);
    expect(body.images).toHaveLength(1);
    expect(body.details).toMatchObject({
      cached: false,
      cacheOf: null,
      patientInitials: "A.B.",
      durationMs: 3_000,
      costUsdMicros: 0,
      shareForReview: false,
      createdBy: { id: customerId },
    });
    expect(body.details.corrections).toEqual([
      expect.objectContaining({
        itemIndex: 0,
        field: "dose",
        before: "1",
        after: "2",
        consentForEval: false,
      }),
    ]);
    const list = await call(health, "GET", `/admin/users/${customerId}/prescriptions`);
    expect(list.json().items[0]).toHaveProperty("skillVersion");
    expect(list.json().items[0]).toHaveProperty("finishedAt");
  });

  it("refuses an expired session", async () => {
    await db()
      .update(phiAccessSessions)
      .set({
        expiresAt: new Date(Date.now() - 1_000),
        createdAt: new Date(Date.now() - 60 * 60_000),
      })
      .where(eq(phiAccessSessions.adminUserId, health.userId));
    expect(
      (await call(health, "GET", `/admin/users/${customerId}/prescriptions/${rxId}`)).statusCode,
    ).toBe(403);
  });

  it("is closed to support unless granted, even with a session", async () => {
    expect(
      (await call(support, "GET", `/admin/users/${customerId}/prescriptions`)).statusCode,
    ).toBe(403);
    expect(
      (
        await call(support, "POST", `/admin/users/${customerId}/phi-sessions`, {
          reason: "dispute",
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe("chats", () => {
  it("lists dates and counts without titles, opens the transcript in a session, audited", async () => {
    const list = await call(health, "GET", `/admin/users/${customerId}/chats`);
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain("Private title");
    expect(list.json().items[0]).toMatchObject({ id: chatId, messageCount: 1 });

    await call(health, "POST", `/admin/users/${customerId}/phi-sessions`, {
      reason: "quality_review",
    });
    const opened = await call(health, "GET", `/admin/users/${customerId}/chats/${chatId}`);
    expect(opened.statusCode, opened.body).toBe(200);
    expect(opened.body).toContain(CHAT_TEXT);
    const views = await ctx.auditRowsFor("phi.view", customerId);
    expect(views.some((row) => (row.after as { recordType?: string }).recordType === "chat")).toBe(
      true,
    );
  });

  it("hides another user's chat behind this user's id", async () => {
    const stranger = (await ctx.harness.signedInUser()).userId;
    expect((await call(health, "GET", `/admin/users/${stranger}/chats/${chatId}`)).statusCode).toBe(
      403,
    );
    await call(health, "POST", `/admin/users/${stranger}/phi-sessions`, { reason: "dispute" });
    expect((await call(health, "GET", `/admin/users/${stranger}/chats/${chatId}`)).statusCode).toBe(
      404,
    );
  });
});
