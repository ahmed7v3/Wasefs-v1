import { createHash, randomUUID } from "node:crypto";

import {
  creditLedger,
  creditReservations,
  creditWallets,
  files,
  grant,
  rxAnalyses,
  rxPages,
  users,
  waConversations,
  waMessages,
  waOutbox,
  waToolEffects,
  waTurns,
} from "@wasfa/db";
import { waCreateDocumentArgsSchema } from "@wasfa/shared/schemas/wa-document";
import { settingDefault } from "@wasfa/shared/settings";
import { uuidFromKey } from "@wasfa/shared/wa-agent/uuid-from-key";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CreditsService } from "../../src/credits/credits.service.js";
import { PlansService } from "../../src/plans/plans.service.js";
import { RxQueue } from "../../src/rx/rx-queue.js";
import { RxService } from "../../src/rx/rx.service.js";
import { SettingsService } from "../../src/settings/settings.service.js";
import { AGENT_TOOLS, bindTools } from "../../src/wa-agent/agent/tools/index.js";
import { ToolEffectsRepo } from "../../src/wa-agent/agent/tools/tool-effects.repo.js";
import { WaAgentCommerceRepo } from "../../src/wa-agent/commerce/agent-commerce.repo.js";
import { WaAgentRepo } from "../../src/wa-agent/conversation/conversation.repo.js";
import { RxReconciler } from "../../src/wa-agent/outbox/rx-reconciler.js";
import { RxReconcilerRepo } from "../../src/wa-agent/outbox/rx-reconciler.repo.js";
import { AgentRxRepo } from "../../src/wa-agent/rx/agent-rx.repo.js";
import { AgentRxService } from "../../src/wa-agent/rx/agent-rx.service.js";
import { RxStartService } from "../../src/wa-agent/rx/rx-start.service.js";
import { AdminTestContext } from "../support/admin-context.js";
import { buyer } from "../support/billing-console-fixtures.js";
import { quietLogger } from "../support/wa-agent-commerce-fakes.js";

import type { FilesService } from "../../src/files/files.service.js";
import type {
  AgentCall,
  AgentToolContext,
  AgentToolDeps,
  ToolCallRecord,
} from "../../src/wa-agent/agent/tools/index.js";
import type { MediaAsset } from "@wasfa/shared/schemas/media";
import type { WaAgentInbound } from "@wasfa/shared/schemas/wa-agent";

/*
 * Exactly-once tools (docs/WA-AGENT-RUNTIME.md section 17.2/17.3) against Postgres: every write tool
 * called three times in one turn acts once, and the rx start is one transaction (claim, analysis,
 * outbox route, effect result) whatever fails around it. The image worker and the storage copy are a files fake.
 */

const ctx = new AdminTestContext();
let phoneCounter = 0;

beforeAll(async () => {
  await ctx.start();
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

const keyOf = (label: string) => createHash("sha256").update(label).digest("hex");

async function linkedCustomer() {
  const person = await buyer(ctx);
  phoneCounter += 1;
  const phone = `+2010${String(50_000_000 + phoneCounter * 13)}`;
  await ctx.owner.db
    .update(users)
    .set({ phone, phoneVerified: true, phoneVerifiedAt: new Date() })
    .where(eq(users.id, person.userId));
  return { ...person, phone };
}

/** A conversation with `pictures` inbound images, and a running turn at fence `fence`. */
async function chat(person: { phone: string }, pictures: number, fence = 1) {
  const repo = ctx.app.get(WaAgentRepo);
  const messageIds: string[] = [];
  let conversationId = "";
  for (let index = 0; index < pictures || index === 0; index++) {
    const entry: WaAgentInbound = {
      waMessageId: randomUUID(),
      jid: `${person.phone.slice(1)}@s.whatsapp.net`,
      phone: person.phone,
      direction: "in",
      kind: pictures === 0 ? "text" : "image",
      ...(pictures === 0
        ? { text: "hello" }
        : { media: { key: `wa/2026/10/${randomUUID()}`, mime: "image/jpeg", bytes: 4_096 } }),
      ts: Date.now(),
    };
    const { conversation } = await repo.ingest(entry, new Date(Date.now() + 60_000));
    conversationId = conversation.id;
    const [message] = await ctx.owner.db
      .select()
      .from(waMessages)
      .where(eq(waMessages.waMessageId, entry.waMessageId));
    if (pictures > 0 && message) messageIds.push(message.id);
  }
  await ctx.owner.db
    .update(waConversations)
    .set({ turnFence: fence })
    .where(eq(waConversations.id, conversationId));
  const [turn] = await ctx.owner.db
    .insert(waTurns)
    .values({ conversationId, state: "running", fence })
    .returning({ id: waTurns.id });
  if (!turn) throw new Error("turn not stored");
  return { conversationId, messageIds, turnId: turn.id };
}

describe("every write tool acts once per turn and arguments", () => {
  const counts = new Map<string, number>();
  const bump = (name: string) => {
    counts.set(name, (counts.get(name) ?? 0) + 1);
    return Promise.resolve({ ok: true, n: counts.get(name) });
  };

  const deps = (): AgentToolDeps => ({
    catalog: { catalog: () => Promise.reject(new Error("unused")) },
    account: { status: () => Promise.reject(new Error("unused")) },
    media: {
      find: () =>
        Promise.resolve({
          status: "ready",
          variants: [{ format: "jpeg", width: 800, key: "media/a/800.jpeg", bytes: 10 }],
        } as MediaAsset),
    },
    mediaOrigin: "https://media.test",
    effects: ctx.app.get(ToolEffectsRepo),
    accounts: {
      create: () => bump("create_account"),
      loginLink: () => bump("login_link").then((r) => ({ ...r, loginUrl: "https://x/secret" })),
    },
    handoff: { raise: () => bump("handoff_to_owner").then(() => undefined) },
    commerce: {
      offerDiscount: () => bump("offer_discount"),
      startSubscription: () => bump("start_subscription"),
      attachReceipt: () => bump("attach_receipt"),
    },
    documents: { create: () => bump("create_document") },
    usage: {
      analyzePrescription: () =>
        bump("analyze_prescription").then((r) => ({ ...r, started: true })),
      askMedical: () => bump("ask_medical"),
    },
    medications: {
      search: () => Promise.resolve([]),
      alternatives: () => Promise.resolve([]),
      showPrices: () => Promise.resolve(false),
    },
  });

  const config = {
    ...settingDefault("waAgent"),
    media: [{ key: "bank", mediaAssetId: randomUUID(), caption: "c" }],
  };

  function context(
    conversationId: string,
    turnId: string,
    linked: boolean,
    fence = 1,
  ): AgentToolContext {
    return {
      conversationId,
      userId: linked ? randomUUID() : null,
      phone: "+201000000001",
      market: { currency: "EGP", country: "EG" },
      config,
      now: new Date(),
      deps: deps(),
      mediaParts: [],
      handoffReason: null,
      turnId,
      fence,
    };
  }

  const document = (fileName: string) =>
    waCreateDocumentArgsSchema.parse({
      template: "report",
      fileName,
      content: { title: "t", sections: [{ heading: "h", paragraphs: ["p"] }] },
    });

  // [tool, linked, arguments, different arguments]
  const CASES: Array<[string, boolean, unknown, unknown]> = [
    ["analyze_prescription", true, {}, undefined],
    ["create_account", false, { confirmed: true, name: "Mona" }, { confirmed: true, name: "Sara" }],
    ["create_document", true, document("a"), document("b")],
    ["offer_discount", true, { planKey: "plus", months: 1 }, { planKey: "plus", months: 3 }],
    ["start_subscription", true, { planKey: "plus", months: 1 }, { planKey: "pro", months: 1 }],
    ["attach_receipt", true, {}, undefined],
    ["handoff_to_owner", true, { reason: "angry" }, { reason: "wants a person" }],
    ["send_media", true, { key: "bank" }, undefined],
    ["ask_medical", true, { question: "dose?" }, { question: "side effects?" }],
    ["login_link", true, {}, undefined],
  ];

  it("covers exactly the ten write tools of the contract", () => {
    const writes = AGENT_TOOLS.filter((tool) => tool.effect === "write").map(
      (tool) => tool.definition.name,
    );
    expect(writes.sort()).toEqual(CASES.map(([name]) => name).sort());
    expect(
      AGENT_TOOLS.filter((tool) => tool.effect === "read")
        .map((tool) => tool.definition.name)
        .sort(),
    ).toEqual(["account_status", "get_catalog", "medication_alternatives", "search_medications"]);
  });

  it.each(CASES)("%s: three identical calls are one effect", async (name, linked, args, other) => {
    const person = await linkedCustomer();
    const { conversationId, turnId } = await chat(person, 0);
    const tool = AGENT_TOOLS.find((entry) => entry.definition.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const records: ToolCallRecord[] = [];
    const toolCtx = context(conversationId, turnId, linked);
    const { handlers } = bindTools([tool], toolCtx, records);
    const handler = handlers[name];
    if (!handler) throw new Error("no handler");
    counts.delete(name);

    const first = await handler(args);
    const second = await handler(args);
    const third = await handler(args);
    expect(counts.get(name) ?? 0, `${name} ran once`).toBeLessThanOrEqual(1);
    if (name === "send_media") {
      // The picture is queued with the reply, once.
      expect(toolCtx.mediaParts).toHaveLength(1);
    } else {
      expect(counts.get(name)).toBe(1);
    }
    expect(second).toEqual(third);
    expect(
      records.every((record) => record.ok),
      JSON.stringify(first),
    ).toBe(true);

    const rows = await ctx.owner.db
      .select()
      .from(waToolEffects)
      .where(eq(waToolEffects.turnId, turnId));
    expect(rows.filter((row) => row.tool === name)).toHaveLength(1);
    expect(rows[0]?.state).toBe("done");
    // Secrets and customer text never rest in the effect row.
    expect(JSON.stringify(rows[0]?.result)).not.toContain("secret");

    if (name === "handoff_to_owner") {
      const rerun = context(conversationId, turnId, linked);
      await bindTools([tool], rerun, []).handlers[name]?.(args);
      expect(rerun.handoffReason, "a re-run still pauses the chat after its reply").toBe("angry");
    }
    if (other !== undefined) {
      counts.delete(name);
      await handler(other);
      expect(counts.get(name), "different arguments are another effect").toBe(1);
      const after = await ctx.owner.db
        .select()
        .from(waToolEffects)
        .where(eq(waToolEffects.turnId, turnId));
      expect(after.filter((row) => row.tool === name)).toHaveLength(2);
    }
  });

  it("another turn repeats the effect, and a stale fence does nothing", async () => {
    const person = await linkedCustomer();
    const { conversationId, turnId } = await chat(person, 0, 3);
    const tool = AGENT_TOOLS.find((entry) => entry.definition.name === "offer_discount");
    if (!tool) throw new Error("no tool");
    counts.delete("offer_discount");
    const args = { planKey: "plus", months: 1 };

    const stale: ToolCallRecord[] = [];
    const staleCtx = context(conversationId, turnId, true, 2);
    const refused = await bindTools([tool], staleCtx, stale).handlers["offer_discount"]?.(args);
    expect(refused).toEqual({ error: "stale_turn" });
    expect(stale).toEqual([{ name: "offer_discount", ok: false, code: "stale_turn" }]);
    expect(counts.get("offer_discount")).toBeUndefined();

    const live = context(conversationId, turnId, true, 3);
    await bindTools([tool], live, []).handlers["offer_discount"]?.(args);
    const [secondTurn] = await ctx.owner.db
      .insert(waTurns)
      .values({ conversationId, state: "running", fence: 3 })
      .returning({ id: waTurns.id });
    await bindTools([tool], context(conversationId, secondTurn?.id ?? "", true, 3), []).handlers[
      "offer_discount"
    ]?.(args);
    expect(counts.get("offer_discount")).toBe(2);
  });
});

describe("the rx start is one transaction", () => {
  let imports = 0;

  function service(
    overrides: { enqueue?: () => Promise<void>; createInTx?: () => Promise<void> } = {},
  ) {
    const filesFake = {
      importObject: () => {
        imports += 1;
        return processedPage(currentUser);
      },
      awaitProcessed: () => Promise.resolve("processed" as const),
      discardImported: () => Promise.resolve(),
    } as unknown as FilesService;
    const rx = ctx.app.get(RxService);
    if (overrides.enqueue) vi.spyOn(rx, "enqueue").mockImplementationOnce(overrides.enqueue);
    if (overrides.createInTx)
      vi.spyOn(rx, "createInTx").mockImplementationOnce(overrides.createInTx);
    return new AgentRxService(
      ctx.app.get(WaAgentCommerceRepo),
      ctx.app.get(AgentRxRepo),
      new RxStartService(
        ctx.app.get(AgentRxRepo),
        filesFake,
        rx,
        ctx.app.get(CreditsService),
        ctx.redis,
        quietLogger,
      ),
      filesFake,
      rx,
      ctx.app.get(PlansService),
      ctx.app.get(CreditsService),
      ctx.app.get(SettingsService),
      ctx.redis,
      quietLogger,
    );
  }

  let currentUser = "";
  async function processedPage(userId: string): Promise<string> {
    const id = randomUUID();
    await ctx.owner.db.insert(files).values({
      id,
      ownerUserId: userId,
      createdBy: userId,
      purpose: "rx_page",
      r2Key: `test/${id}.jpg`,
      mime: "image/jpeg",
      bytes: 5_000,
      sha256: randomUUID().replaceAll("-", "").padEnd(64, "b"),
      dhash: "0123456789abcdef",
      status: "processed",
    });
    return id;
  }

  function callFor(
    userId: string,
    conversationId: string,
    key: string,
    turnId: string,
    fence: number,
  ): AgentCall {
    return {
      conversationId,
      userId,
      market: { currency: "EGP", country: "EG" },
      config: settingDefault("waAgent"),
      now: new Date(),
      effect: { key, turnId, fence },
    };
  }

  async function setup(fence = 1) {
    const person = await linkedCustomer();
    currentUser = person.userId;
    await grant(ctx.owner.db, { type: "user", id: person.userId }, 30, "2026-10");
    const room = await chat(person, 1, fence);
    return { person, ...room };
  }

  const state = async (userId: string, conversationId: string, messageIds: string[]) => {
    const analyses = await ctx.owner.db
      .select()
      .from(rxAnalyses)
      .where(eq(rxAnalyses.ownerUserId, userId));
    const outbox = await ctx.owner.db
      .select()
      .from(waOutbox)
      .where(eq(waOutbox.conversationId, conversationId));
    const messages = await ctx.owner.db
      .select()
      .from(waMessages)
      .where(inArray(waMessages.id, messageIds));
    return { analyses, outbox, messages };
  };

  it("claims the picture, creates the analysis, routes it and stores the result together", async () => {
    const { person, conversationId, messageIds, turnId } = await setup();
    const key = keyOf("happy");
    const result = await service().analyze(callFor(person.userId, conversationId, key, turnId, 1));
    expect(result).toMatchObject({ started: true, pages: 1, etaSeconds: 60 });

    const id = uuidFromKey(key);
    const { analyses, outbox, messages } = await state(person.userId, conversationId, messageIds);
    expect(analyses.map((row) => [row.id, row.status])).toEqual([[id, "queued"]]);
    expect(outbox).toMatchObject([
      {
        kind: "rx_result",
        idempotencyKey: `rx:${id}`,
        refId: id,
        state: "waiting",
        paidWork: true,
      },
    ]);
    expect(messages[0]?.meta).toMatchObject({ rxId: id });
    const [effect] = await ctx.owner.db
      .select()
      .from(waToolEffects)
      .where(eq(waToolEffects.key, key));
    expect(effect).toMatchObject({ state: "done", tool: "analyze_prescription", result });
    const pagesOf = await ctx.owner.db.select().from(rxPages).where(eq(rxPages.analysisId, id));
    expect(pagesOf).toHaveLength(1);
  });

  it("a crash after the commit and before the job leaves a started analysis the reconciler queues once", async () => {
    const { person, conversationId, messageIds, turnId } = await setup();
    const key = keyOf("after-commit");
    const result = await service({
      enqueue: () => Promise.reject(new Error("redis down")),
    }).analyze(callFor(person.userId, conversationId, key, turnId, 1));
    expect(result).toMatchObject({ started: true });
    const id = uuidFromKey(key);
    const { analyses, outbox, messages } = await state(person.userId, conversationId, messageIds);
    expect(analyses.map((row) => row.status)).toEqual(["queued"]);
    expect(outbox).toHaveLength(1);
    expect(messages[0]?.meta).toMatchObject({ rxId: id });

    const added: string[] = [];
    const reconciler = new RxReconciler(
      ctx.app.get(RxReconcilerRepo),
      {
        analyze: (analysisId: string) => (added.push(analysisId), Promise.resolve()),
      } as unknown as RxQueue,
      quietLogger,
    );
    expect(await reconciler.sweep(new Date()), "too young to be lost").toBe(0);
    const later = new Date(Date.now() + 121_000);
    expect(await reconciler.sweep(later)).toBeGreaterThanOrEqual(1);
    expect(added.filter((entry) => entry === id)).toEqual([id]);
  });

  it("a crash before the commit leaves nothing; the retry reuses the file and the hold and succeeds once", async () => {
    const { person, conversationId, messageIds, turnId } = await setup();
    const key = keyOf("before-commit");
    const id = uuidFromKey(key);
    imports = 0;
    await expect(
      service({ createInTx: () => Promise.reject(new Error("db died mid-transaction")) }).analyze(
        callFor(person.userId, conversationId, key, turnId, 1),
      ),
    ).rejects.toThrow("db died");
    const crashed = await state(person.userId, conversationId, messageIds);
    expect(crashed.analyses).toEqual([]);
    expect(crashed.outbox).toEqual([]);
    expect(crashed.messages[0]?.meta).not.toHaveProperty("rxId");
    expect(crashed.messages[0]?.meta).toHaveProperty("fileId");
    expect(
      await ctx.owner.db.select().from(waToolEffects).where(eq(waToolEffects.key, key)),
    ).toEqual([]);

    const retry = await service().analyze(callFor(person.userId, conversationId, key, turnId, 1));
    expect(retry).toMatchObject({ started: true });
    expect(imports, "the picture was imported once").toBe(1);
    const after = await state(person.userId, conversationId, messageIds);
    expect(after.analyses.map((row) => row.id)).toEqual([id]);
    expect(after.outbox).toHaveLength(1);

    const [wallet] = await ctx.owner.db
      .select()
      .from(creditWallets)
      .where(eq(creditWallets.ownerUserId, person.userId));
    const holds = await ctx.owner.db
      .select()
      .from(creditReservations)
      .where(eq(creditReservations.walletId, wallet?.id ?? ""));
    expect(holds, "one reservation for the analysis id").toHaveLength(1);
    const ledger = await ctx.owner.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.idempotencyKey, `reserve:rx:${id}:reserve`));
    expect(ledger).toHaveLength(1);
  });

  it("a stale fence writes nothing and is refused", async () => {
    const { person, conversationId, messageIds, turnId } = await setup(5);
    const key = keyOf("stale");
    await expect(
      service().analyze(callFor(person.userId, conversationId, key, turnId, 4)),
    ).rejects.toMatchObject({ name: "StaleFenceError" });
    const after = await state(person.userId, conversationId, messageIds);
    expect(after.analyses).toEqual([]);
    expect(after.outbox).toEqual([]);
    expect(after.messages[0]?.meta).not.toHaveProperty("rxId");
    expect(
      await ctx.owner.db.select().from(waToolEffects).where(eq(waToolEffects.key, key)),
    ).toEqual([]);
  });

  it("refuses with already_analysed when a picture is taken, claiming none of them", async () => {
    const { person, conversationId, messageIds, turnId } = await setup();
    await ctx.owner.db
      .update(waMessages)
      .set({ meta: { rxId: randomUUID() } })
      .where(eq(waMessages.id, messageIds[0] ?? ""));
    // The only picture is taken, so the selection is empty.
    expect(
      await service().analyze(callFor(person.userId, conversationId, keyOf("taken"), turnId, 1)),
    ).toMatchObject({ started: false, reason: "no_image" });

    // Taken between the selection and the commit: all or nothing.
    const commerce = ctx.app.get(AgentRxRepo);
    const second = await setup();
    const other = second.messageIds[0] ?? "";
    await expect(
      commerce.commitRxStart({
        effectKey: keyOf("race"),
        turnId: second.turnId,
        conversationId: second.conversationId,
        mediaIds: [other, messageIds[0] ?? ""],
        analysisId: randomUUID(),
        result: {},
        create: () => Promise.resolve(),
      }),
    ).rejects.toMatchObject({ name: "RxAlreadyAnalysedError" });
    const [row] = await ctx.owner.db.select().from(waMessages).where(eq(waMessages.id, other));
    expect(row?.meta).not.toHaveProperty("rxId");
  });
});
