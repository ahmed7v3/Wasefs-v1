import { randomInt, randomUUID } from "node:crypto";

import {
  aiUsage,
  auditLogs,
  getIntegrationSecret,
  insertInbound,
  insertOutbound,
  integrationSecrets,
  markOutbound,
  mediaAssets,
  upsertConversation,
  users,
  waMessages,
  type WaConversation,
} from "@wasfa/db";
import { decryptSecret } from "@wasfa/shared/crypto";
import {
  waAgentAdminSettingsSchema,
  waAgentConversationPageSchema,
  waAgentConversationStateSchema,
  voiceTestResultSchema,
  waAgentMediaUrlSchema,
  waAgentMessagePageSchema,
  waAgentUsageSchema,
} from "@wasfa/shared/schemas/admin-wa-agent";
import { waAgentPauseKey } from "@wasfa/shared/schemas/wa-agent";
import { waAgentSettingsSchema } from "@wasfa/shared/settings";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { encryptionKey } from "../src/config/env.js";
import { ObjectStorage } from "../src/files/object-storage.js";
import { ElevenLabsClient } from "../src/wa-agent/voice/elevenlabs.client.js";
import { WaAgentVoiceService } from "../src/wa-agent/voice/voice.service.js";

import { AdminTestContext, MISSING_ID, type Admin } from "./support/admin-context.js";

import type { LightMyRequestResponse } from "fastify";

/*
 * The WhatsApp agent's admin panel (docs/WA-AGENT.md work package E): who may read settings, usage
 * and transcripts, the settings round trip, the encrypted voice key that no route ever returns,
 * audited transcript and media reads limited to `wa/` objects, and the chat controls.
 */

const ctx = new AdminTestContext();
const db = () => ctx.owner.db;
let boss: Admin;
let reader: Admin;
let writer: Admin;
let inbox: Admin;
const KEY = "xi-test-key-0123456789-abcdefghij";

beforeAll(async () => {
  await ctx.start();
  boss = await ctx.admin("super_admin");
  reader = await ctx.admin(await ctx.customRole(["wa_agent.read"]));
  writer = await ctx.admin(await ctx.customRole(["wa_agent.read", "wa_agent.write"]));
  inbox = await ctx.admin(await ctx.customRole(["wa_agent.inbox"]));
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

type Method = "GET" | "POST" | "PUT" | "DELETE";
const call = (
  method: Method,
  url: string,
  who: { jar: Admin["jar"] },
  body?: Record<string, unknown>,
) => ctx.harness.call(method, url, { jar: who.jar, ...(body ? { body } : {}) });

function expectError(res: LightMyRequestResponse, status: number, code: string, reason?: string) {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json()).toMatchObject({ code, ...(reason ? { details: { reason } } : {}) });
}

const auditOf = (action: string, targetId?: string) =>
  db()
    .select()
    .from(auditLogs)
    .where(
      targetId === undefined
        ? eq(auditLogs.action, action)
        : and(eq(auditLogs.action, action), eq(auditLogs.targetId, targetId)),
    )
    .orderBy(desc(auditLogs.createdAt));

async function seedConversation(
  userId: string | null = null,
): Promise<{ conversation: WaConversation; phone: string }> {
  const phone = `+2010${String(randomInt(10_000_000, 99_999_999))}`;
  const conversation = await upsertConversation(db(), {
    jid: `${phone.slice(1)}@s.whatsapp.net`,
    phone,
    userId,
  });
  return { conversation, phone };
}

const inbound = (conversationId: string, text: string | null, extra = {}) =>
  insertInbound(db(), {
    conversationId,
    direction: "in",
    kind: "text",
    ...(text === null ? {} : { text }),
    waMessageId: `wamid-${randomUUID()}`,
    ts: Date.now(),
    ...extra,
  });

describe("permissions", () => {
  it("lets a reader see settings and usage but not change them or open the inbox", async () => {
    expect((await call("GET", "/admin/wa-agent/settings", reader)).statusCode).toBe(200);
    expect((await call("GET", "/admin/wa-agent/usage", reader)).statusCode).toBe(200);
    expectError(
      await call("PUT", "/admin/wa-agent/settings", reader, waAgentSettingsSchema.parse({})),
      403,
      "FORBIDDEN",
    );
    expectError(
      await call("PUT", "/admin/wa-agent/voice-key", reader, { apiKey: KEY }),
      403,
      "FORBIDDEN",
    );
    expectError(await call("DELETE", "/admin/wa-agent/voice-key", reader), 403, "FORBIDDEN");
    expectError(await call("GET", "/admin/wa-agent/conversations", reader), 403, "FORBIDDEN");
    const { conversation } = await seedConversation();
    expectError(
      await call("GET", `/admin/wa-agent/conversations/${conversation.id}/messages`, reader),
      403,
      "FORBIDDEN",
    );
    expectError(
      await call("POST", `/admin/wa-agent/conversations/${conversation.id}/block`, reader),
      403,
      "FORBIDDEN",
    );
  });

  it("keeps transcripts behind their own permission, away from settings holders", async () => {
    expect((await call("GET", "/admin/wa-agent/conversations", inbox)).statusCode).toBe(200);
    expectError(await call("GET", "/admin/wa-agent/settings", inbox), 403, "FORBIDDEN");
    expectError(await call("GET", "/admin/wa-agent/usage", inbox), 403, "FORBIDDEN");
    // A holder of settings.write cannot reach the agent through the generic settings route either.
    const generic = await call("PUT", "/admin/settings/waAgent", boss, { enabled: true });
    expectError(generic, 403, "FORBIDDEN", "use_admin_wa_agent");
  });

  it("requires a signed-in admin", async () => {
    expectError(
      await ctx.harness.call("GET", "/admin/wa-agent/settings", {}),
      401,
      "AUTH_REQUIRED",
    );
  });
});

describe("settings", () => {
  it("round-trips the whole setting and audits the change", async () => {
    const before = waAgentAdminSettingsSchema.parse(
      (await call("GET", "/admin/wa-agent/settings", writer)).json(),
    );
    expect(before.settings.enabled).toBe(false);
    expect(before.voiceKey).toEqual({ set: false, hint: null, updatedAt: null });
    expect(before.verification.mode).toBeTruthy();

    const next = waAgentSettingsSchema.parse({
      ...before.settings,
      enabled: true,
      persona: "أنا مساعد وصفة",
      replyDelaySeconds: 12,
      spendCapUsdMicros: 7_500_000,
      discounts: { ...before.settings.discounts, enabled: true, percentOff: 15 },
    });
    const res = await call("PUT", "/admin/wa-agent/settings", writer, next);
    expect(res.statusCode, res.body).toBe(200);
    const saved = waAgentAdminSettingsSchema.parse(res.json());
    expect(saved.settings).toEqual(next);
    const again = waAgentAdminSettingsSchema.parse(
      (await call("GET", "/admin/wa-agent/settings", reader)).json(),
    );
    expect(again.settings).toEqual(next);
    expect(
      (await auditOf("setting.update", "waAgent")).some((row) => row.actorId === writer.userId),
    ).toBe(true);
  });

  it("refuses values outside the schema, naming the field and not echoing the value", async () => {
    const res = await call("PUT", "/admin/wa-agent/settings", writer, {
      ...waAgentSettingsSchema.parse({}),
      replyDelaySeconds: 1,
    });
    expectError(res, 400, "VALIDATION_FAILED");
    expect(res.body).not.toContain('"replyDelaySeconds":1');
  });

  it("accepts only finished library images in the media list, each key once", async () => {
    const ready = randomUUID();
    const staged = randomUUID();
    await db()
      .insert(mediaAssets)
      .values([
        {
          id: ready,
          sha256: randomUUID().replaceAll("-", "").repeat(2),
          status: "ready",
          mime: "image/png",
        },
        { id: staged, sha256: randomUUID().replaceAll("-", "").repeat(2), status: "staged" },
      ]);
    const base = waAgentSettingsSchema.parse({});
    const put = (media: Array<Record<string, unknown>>) =>
      call("PUT", "/admin/wa-agent/settings", writer, { ...base, media });

    expect(
      (await put([{ key: "bank-card", mediaAssetId: ready, caption: "بيانات التحويل" }]))
        .statusCode,
    ).toBe(200);
    expectError(
      await put([{ key: "missing", mediaAssetId: MISSING_ID }]),
      400,
      "VALIDATION_FAILED",
      "media_asset_invalid",
    );
    expectError(
      await put([{ key: "not-ready", mediaAssetId: staged }]),
      400,
      "VALIDATION_FAILED",
      "media_asset_invalid",
    );
    expectError(
      await put([
        { key: "same", mediaAssetId: ready },
        { key: "same", mediaAssetId: ready },
      ]),
      400,
      "VALIDATION_FAILED",
      "duplicate_media_key",
    );
  });
});

describe("the voice key", () => {
  it("is stored encrypted, never returned, and cleared on request", async () => {
    const res = await call("PUT", "/admin/wa-agent/voice-key", writer, { apiKey: KEY });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain(KEY);
    expect(res.json()).toMatchObject({ set: true });

    const [row] = await db().select().from(integrationSecrets);
    expect(row?.key).toBe("elevenlabs");
    expect(row?.valueEnc).not.toContain(KEY);
    expect(row?.keyHint).not.toBe(KEY);
    expect(
      decryptSecret(row?.valueEnc ?? "", encryptionKey(ctx.env), "integration_secret:elevenlabs"),
    ).toBe(KEY);
    // A ciphertext moved to another context does not open.
    expect(() =>
      decryptSecret(row?.valueEnc ?? "", encryptionKey(ctx.env), "ai_provider:x"),
    ).toThrow();
    expect(await getIntegrationSecret(db(), "elevenlabs", encryptionKey(ctx.env))).toBe(KEY);

    const settings = await call("GET", "/admin/wa-agent/settings", reader);
    expect(settings.body).not.toContain(KEY);
    expect(waAgentAdminSettingsSchema.parse(settings.json()).voiceKey).toMatchObject({
      set: true,
      hint: row?.keyHint,
    });

    const audits = await auditOf("wa_agent.voice_key_set", "elevenlabs");
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain(KEY);

    expect((await call("DELETE", "/admin/wa-agent/voice-key", writer)).statusCode).toBe(204);
    expect(await getIntegrationSecret(db(), "elevenlabs", encryptionKey(ctx.env))).toBeNull();
    expect(
      waAgentAdminSettingsSchema.parse(
        (await call("GET", "/admin/wa-agent/settings", reader)).json(),
      ).voiceKey.set,
    ).toBe(false);
    expect((await auditOf("wa_agent.voice_key_clear", "elevenlabs")).length).toBeGreaterThan(0);
  });

  it("refuses a key that is too short", async () => {
    expectError(
      await call("PUT", "/admin/wa-agent/voice-key", writer, { apiKey: "short" }),
      400,
      "VALIDATION_FAILED",
    );
  });
});

describe("the voice test", () => {
  const settingsWithVoice = async (voiceId: string) => {
    const current = waAgentAdminSettingsSchema.parse(
      (await call("GET", "/admin/wa-agent/settings", writer)).json(),
    ).settings;
    const res = await call("PUT", "/admin/wa-agent/settings", writer, {
      ...current,
      voice: { ...current.voice, enabled: true, voiceId },
    });
    expect(res.statusCode, res.body).toBe(200);
  };

  it("needs wa_agent.write: a reader and an inbox-only admin are refused", async () => {
    expectError(await call("POST", "/admin/wa-agent/voice-test", reader, { text: "hi" }), 403, "FORBIDDEN");
    expectError(await call("POST", "/admin/wa-agent/voice-test", inbox, { text: "hi" }), 403, "FORBIDDEN");
  });

  it("validates the text, and explains a missing key or voice id", async () => {
    expectError(
      await call("POST", "/admin/wa-agent/voice-test", writer, { text: "x".repeat(301) }),
      400,
      "VALIDATION_FAILED",
    );
    await call("DELETE", "/admin/wa-agent/voice-key", writer);
    expectError(
      await call("POST", "/admin/wa-agent/voice-test", writer, { text: "hi" }),
      409,
      "CONFLICT",
      "voice_key_missing",
    );
    await call("PUT", "/admin/wa-agent/voice-key", writer, { apiKey: KEY });
    await settingsWithVoice("");
    expectError(
      await call("POST", "/admin/wa-agent/voice-test", writer, { text: "hi" }),
      409,
      "CONFLICT",
      "voice_id_missing",
    );
  });

  it("speaks with the saved settings, returns a 60 second link, audits, and never shows the key", async () => {
    await call("PUT", "/admin/wa-agent/voice-key", writer, { apiKey: KEY });
    await settingsWithVoice("voice-test-1");
    const client = ctx.app.get(ElevenLabsClient);
    const seen: Array<{ url: string; key: string | undefined }> = [];
    client.fetchImpl = (input, init) => {
      seen.push({
        url: String(input),
        key: (init?.headers as Record<string, string> | undefined)?.["xi-api-key"],
      });
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    };
    const storage = ctx.app.get(ObjectStorage);
    const put = vi.spyOn(storage, "put").mockResolvedValue();
    const voice = ctx.app.get(WaAgentVoiceService);
    voice.scheduleRemoval = () => undefined;

    const res = await call("POST", "/admin/wa-agent/voice-test", writer, { text: "اهلا بيك" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain(KEY);
    const clip = voiceTestResultSchema.parse(res.json());
    expect(clip).toMatchObject({ mime: "audio/ogg", chars: 8, expiresInSeconds: 60 });
    expect(new URL(clip.url).searchParams.get("X-Amz-Expires")).toBe("60");
    expect(clip.url).toContain("wa/test/");
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[0]).toMatch(/^wa\/test\/\d{4}\/\d{2}\/[0-9a-f-]+\.ogg$/);
    expect(seen).toEqual([
      {
        url: "https://api.elevenlabs.io/v1/text-to-speech/voice-test-1?output_format=opus_48000_64",
        key: KEY,
      },
    ]);
    const audits = await auditOf("wa_agent.voice_test", "elevenlabs");
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain(KEY);
    put.mockRestore();
    await call("DELETE", "/admin/wa-agent/voice-key", writer);
  });

  it("allows 10 tests per admin per hour", async () => {
    const tester = await ctx.admin(await ctx.customRole(["wa_agent.read", "wa_agent.write"]));
    await call("DELETE", "/admin/wa-agent/voice-key", writer);
    for (let attempt = 0; attempt < 10; attempt++) {
      expectError(
        await call("POST", "/admin/wa-agent/voice-test", tester, { text: "hi" }),
        409,
        "CONFLICT",
        "voice_key_missing",
      );
    }
    expectError(
      await call("POST", "/admin/wa-agent/voice-test", tester, { text: "hi" }),
      429,
      "RATE_LIMITED",
    );
  });
});

describe("the inbox", () => {
  it("lists chats with the number masked unless the search matched it, and filters", async () => {
    const [account] = await db().select({ id: users.id, name: users.name }).from(users).limit(1);
    const { conversation: linked, phone } = await seedConversation(account?.id ?? null);
    const { conversation: guest } = await seedConversation(null);
    await inbound(linked.id, "x".repeat(200));

    const list = waAgentConversationPageSchema.parse(
      (await call("GET", "/admin/wa-agent/conversations?limit=100", inbox)).json(),
    );
    const item = list.items.find((entry) => entry.id === linked.id);
    expect(item?.phone).toBe(`+${"•".repeat(phone.length - 5)}${phone.slice(-4)}`);
    expect(item?.preview?.length).toBe(80);
    expect(item?.user).toMatchObject({ id: account?.id });

    const bySearch = waAgentConversationPageSchema.parse(
      (
        await call(
          "GET",
          `/admin/wa-agent/conversations?q=${encodeURIComponent(phone.slice(1))}`,
          inbox,
        )
      ).json(),
    );
    expect(bySearch.items.map((entry) => entry.phone)).toContain(phone);

    const guests = waAgentConversationPageSchema.parse(
      (await call("GET", "/admin/wa-agent/conversations?linked=false&limit=100", inbox)).json(),
    );
    expect(guests.items.every((entry) => entry.user === null)).toBe(true);
    expect(guests.items.map((entry) => entry.id)).toContain(guest.id);
    expect(guests.items.map((entry) => entry.id)).not.toContain(linked.id);

    expectError(
      await call("GET", "/admin/wa-agent/conversations?status=nonsense", inbox),
      400,
      "VALIDATION_FAILED",
    );
  });

  it("pages a transcript newest first, with tool names, and audits each read", async () => {
    const { conversation } = await seedConversation();
    await inbound(conversation.id, "first");
    const [reply] = await insertOutbound(db(), conversation.id, [{ kind: "text", text: "reply" }]);
    await markOutbound(db(), reply ?? "", "dropped", { reason: "paused" });
    await db()
      .update(waMessages)
      .set({ meta: { tools: [{ name: "get_catalog" }, "send_media"] } })
      .where(eq(waMessages.id, reply ?? ""));

    const before = (await auditOf("wa_agent.transcript_view", conversation.id)).length;
    const res = await call(
      "GET",
      `/admin/wa-agent/conversations/${conversation.id}/messages`,
      inbox,
    );
    expect(res.statusCode, res.body).toBe(200);
    const page = waAgentMessagePageSchema.parse(res.json());
    expect(page.items.map((message) => message.text)).toEqual(["reply", "first"]);
    expect(page.items[0]).toMatchObject({
      direction: "out",
      status: "dropped",
      dropReason: "paused",
      tools: ["get_catalog", "send_media"],
      hasMedia: false,
    });
    expect(page.nextCursor).toBeNull();
    const rows = await auditOf("wa_agent.transcript_view", conversation.id);
    expect(rows).toHaveLength(before + 1);
    expect(rows[0]?.actorId).toBe(inbox.userId);

    expectError(
      await call("GET", `/admin/wa-agent/conversations/${MISSING_ID}/messages`, inbox),
      404,
      "NOT_FOUND",
    );
  });

  it("signs a short link only for wa/ objects, and audits it", async () => {
    const { conversation } = await seedConversation();
    const mediaKey = `wa/2026/10/${randomUUID()}`;
    await inbound(conversation.id, null, {
      kind: "image",
      media: { key: mediaKey, mime: "image/jpeg", bytes: 1_000 },
    });
    const [withMedia] = await db()
      .select({ id: waMessages.id })
      .from(waMessages)
      .where(eq(waMessages.mediaKey, mediaKey));
    const outside = await db()
      .insert(waMessages)
      .values({
        conversationId: conversation.id,
        direction: "in",
        kind: "image",
        mediaKey: "uploads/someone-elses-file.jpg",
        status: "received",
      })
      .returning({ id: waMessages.id });
    const plain = await inbound(conversation.id, "no media");

    const res = await call("GET", `/admin/wa-agent/messages/${withMedia?.id}/media-url`, inbox);
    expect(res.statusCode, res.body).toBe(200);
    const link = waAgentMediaUrlSchema.parse(res.json());
    expect(link.url).toContain(mediaKey);
    expect(link.expiresInSeconds).toBe(60);
    expect(new URL(link.url).searchParams.get("X-Amz-Expires")).toBe("60");
    expect((await auditOf("wa_agent.media_view", withMedia?.id)).length).toBe(1);

    expectError(
      await call("GET", `/admin/wa-agent/messages/${outside[0]?.id}/media-url`, inbox),
      404,
      "NOT_FOUND",
    );
    expectError(
      await call("GET", `/admin/wa-agent/messages/${plain}/media-url`, inbox),
      404,
      "NOT_FOUND",
    );
    expectError(
      await call("GET", `/admin/wa-agent/messages/${MISSING_ID}/media-url`, inbox),
      404,
      "NOT_FOUND",
    );
  });
});

describe("chat controls", () => {
  it("pauses, resumes, blocks and unblocks, mirroring the state and auditing each step", async () => {
    const { conversation } = await seedConversation();
    const url = (action: string) => `/admin/wa-agent/conversations/${conversation.id}/${action}`;

    const paused = waAgentConversationStateSchema.parse(
      (await call("POST", url("pause"), writer, { minutes: 60 })).json(),
    );
    expect(paused.status).toBe("paused");
    const until = Date.parse(paused.pausedUntil ?? "");
    expect(until).toBeGreaterThan(Date.now() + 59 * 60_000);
    expect(until).toBeLessThan(Date.now() + 61 * 60_000);
    expect(await ctx.redis.exists(waAgentPauseKey(conversation.jid))).toBe(1);

    expectError(await call("POST", url("pause"), writer, { minutes: 1 }), 400, "VALIDATION_FAILED");
    expectError(
      await call("POST", url("pause"), writer, { minutes: 20_000 }),
      400,
      "VALIDATION_FAILED",
    );

    expect(
      waAgentConversationStateSchema.parse((await call("POST", url("resume"), writer)).json()),
    ).toMatchObject({ status: "active", pausedUntil: null });
    expect(await ctx.redis.exists(waAgentPauseKey(conversation.jid))).toBe(0);

    expectError(await call("POST", url("unblock"), writer), 409, "CONFLICT", "not_blocked");
    expect(
      waAgentConversationStateSchema.parse((await call("POST", url("block"), writer)).json())
        .status,
    ).toBe("blocked");
    expect(
      waAgentConversationStateSchema.parse((await call("POST", url("unblock"), writer)).json())
        .status,
    ).toBe("active");

    for (const action of ["pause", "resume", "block", "unblock"]) {
      expect(
        (await auditOf(`wa_agent.conversation_${action}`, conversation.id)).length,
        action,
      ).toBeGreaterThan(0);
    }
    for (const action of ["pause", "resume", "block", "unblock"]) {
      expectError(
        await call(
          "POST",
          `/admin/wa-agent/conversations/${MISSING_ID}/${action}`,
          writer,
          action === "pause" ? { minutes: 60 } : undefined,
        ),
        404,
        "NOT_FOUND",
      );
    }
  });
});

describe("usage", () => {
  it("counts per UTC day, adds the agent's AI cost and reports today against the cap", async () => {
    const { conversation } = await seedConversation();
    await inbound(conversation.id, "ping");
    const [sent] = await insertOutbound(db(), conversation.id, [{ kind: "text", text: "pong" }]);
    await markOutbound(db(), sent ?? "", "sent", { waMessageId: `wamid-${randomUUID()}` });
    const [late] = await insertOutbound(db(), conversation.id, [{ kind: "text", text: "late" }]);
    await markOutbound(db(), late ?? "", "dropped", { reason: "cap_chat_hour" });
    await db()
      .insert(aiUsage)
      .values({
        task: "wa_agent",
        modelKey: "test-model",
        outcome: "ok",
        costUsdMicros: 1_250_000,
      });
    await call("PUT", "/admin/wa-agent/settings", writer, {
      ...waAgentSettingsSchema.parse({}),
      spendCapUsdMicros: 5_000_000,
    });

    const res = await call("GET", "/admin/wa-agent/usage?days=7", reader);
    expect(res.statusCode, res.body).toBe(200);
    const usage = waAgentUsageSchema.parse(res.json());
    expect(usage.days).toHaveLength(7);
    const today = usage.days.at(-1);
    expect(today?.day).toBe(new Date().toISOString().slice(0, 10));
    expect(today?.inbound).toBeGreaterThanOrEqual(1);
    expect(today?.outboundSent).toBeGreaterThanOrEqual(1);
    expect(today?.dropped["cap_chat_hour"]).toBeGreaterThanOrEqual(1);
    expect(today?.costUsdMicros).toBeGreaterThanOrEqual(1_250_000);
    expect(usage.today).toEqual({
      spendUsdMicros: today?.costUsdMicros,
      spendCapUsdMicros: 5_000_000,
    });

    expect(
      waAgentUsageSchema.parse((await call("GET", "/admin/wa-agent/usage?days=30", reader)).json())
        .days,
    ).toHaveLength(30);
    expectError(
      await call("GET", "/admin/wa-agent/usage?days=3", reader),
      400,
      "VALIDATION_FAILED",
    );
  });
});
