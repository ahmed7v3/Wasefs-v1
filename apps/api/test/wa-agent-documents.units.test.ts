import { waCreateDocumentArgsSchema } from "@wasfa/shared/schemas/wa-document";
import { settingDefault } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "../src/wa-agent/agent/agent-prompt.js";
import {
  bindTools,
  toolsFor,
  type AgentToolContext,
  type ToolCallRecord,
} from "../src/wa-agent/agent/tools/index.js";
import {
  AgentDocumentService,
  DOCUMENTS_PER_CONVERSATION_PER_DAY,
  DOCUMENTS_PER_DAY,
  type DocumentCall,
} from "../src/wa-agent/documents/agent-document.service.js";

import {
  COMMERCE_CONVERSATION_ID,
  quietLogger,
  unusedCommerceDeps,
} from "./support/wa-agent-commerce-fakes.js";
import { MemoryRedis } from "./support/wa-agent-fakes.js";

import type {
  WaCreateDocumentArgs,
  WaRenderDocumentPayload,
} from "@wasfa/shared/schemas/wa-document";

/*
 * `create_document` with fakes: who may make which file, the caps, and that the tool hands the
 * validated payload to the worker's queue. The queue, Redis and the render itself are fakes.
 */

const NOW = new Date("2026-10-27T10:00:00.000Z");

const report = (overrides: Partial<WaCreateDocumentArgs> = {}): WaCreateDocumentArgs =>
  waCreateDocumentArgsSchema.parse({
    template: "report",
    fileName: "ملخص.pdf",
    content: { title: "t", sections: [{ heading: "h", paragraphs: ["p"] }] },
    ...overrides,
  });
const card = () =>
  waCreateDocumentArgsSchema.parse({
    template: "card",
    fileName: "card",
    content: { title: "t", lines: ["l"] },
  });
const schedule = () =>
  waCreateDocumentArgsSchema.parse({
    template: "schedule",
    fileName: "plan",
    content: { title: "t", rows: [{ medicine: "m", dose: "d", times: ["8:00"] }] },
  });

function setup(options: { failQueue?: boolean } = {}) {
  const redis = new MemoryRedis();
  const jobs: WaRenderDocumentPayload[] = [];
  const queue = {
    render: (payload: WaRenderDocumentPayload) => {
      if (options.failQueue) return Promise.reject(new Error("redis down"));
      jobs.push(payload);
      return Promise.resolve();
    },
  };
  const service = new AgentDocumentService(queue as never, redis as never, quietLogger);
  const make = (args: WaCreateDocumentArgs, overrides: Partial<DocumentCall> = {}) =>
    service.create({
      conversationId: COMMERCE_CONVERSATION_ID,
      linked: true,
      language: "ar",
      args,
      now: NOW,
      ...overrides,
    });
  return { service, redis, jobs, make };
}

describe("AgentDocumentService", () => {
  it("queues the render for a linked chat and says it started", async () => {
    const { make, jobs } = setup();
    expect(await make(report())).toEqual({ creating: true });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      conversationId: COMMERCE_CONVERSATION_ID,
      template: "report",
      language: "ar",
      fileName: "ملخص",
    });
  });

  it("uses the language the model chose, else the chat's", async () => {
    const { make, jobs } = setup();
    await make(report(), { language: "en" });
    await make(report({ language: "ar" }), { language: "en" });
    expect(jobs.map((job) => job.language)).toEqual(["en", "ar"]);
  });

  it("lets a guest make a report or table only, and only one an hour", async () => {
    const { make, jobs } = setup();
    expect(await make(card(), { linked: false })).toEqual({ error: "not_linked" });
    expect(await make(schedule(), { linked: false })).toEqual({ error: "not_linked" });
    expect(await make(report(), { linked: false })).toEqual({ creating: true });
    expect(await make(report(), { linked: false })).toEqual({ error: "limit_reached" });
    expect(jobs).toHaveLength(1);
  });

  it("lets a guest make another file after the hour", async () => {
    const { make, redis } = setup();
    await make(report(), { linked: false });
    // The key expires after an hour; Redis does that, here it is removed by hand.
    redis.values.delete(`wa:agent:doc:guest:${COMMERCE_CONVERSATION_ID}`);
    expect(await make(report(), { linked: false })).toEqual({ creating: true });
  });

  it("caps a linked chat per day and counts days apart", async () => {
    const { make, jobs } = setup();
    for (let i = 0; i < DOCUMENTS_PER_CONVERSATION_PER_DAY; i++) {
      expect(await make(report())).toEqual({ creating: true });
    }
    expect(await make(report())).toEqual({ error: "limit_reached" });
    expect(jobs).toHaveLength(DOCUMENTS_PER_CONVERSATION_PER_DAY);
    // The next day starts a new count.
    expect(await make(report(), { now: new Date("2026-10-28T00:00:01.000Z") })).toEqual({
      creating: true,
    });
  });

  it("stops at the global daily cap and gives the count back", async () => {
    const { make, redis, jobs } = setup();
    redis.values.set("wa:agent:doc:total:2026-10-27", String(DOCUMENTS_PER_DAY));
    expect(await make(report())).toEqual({ error: "limit_reached" });
    expect(redis.values.get("wa:agent:doc:total:2026-10-27")).toBe(String(DOCUMENTS_PER_DAY));
    expect(jobs).toHaveLength(0);
  });

  it("gives every count back when the job cannot be queued", async () => {
    const { make, redis } = setup({ failQueue: true });
    expect(await make(report(), { linked: false })).toEqual({ error: "unavailable" });
    expect(redis.values.has(`wa:agent:doc:guest:${COMMERCE_CONVERSATION_ID}`)).toBe(false);
    expect(redis.values.get("wa:agent:doc:total:2026-10-27")).toBe("0");

    const linked = setup({ failQueue: true });
    expect(await linked.make(report())).toEqual({ error: "unavailable" });
    expect(
      linked.redis.values.get(`wa:agent:doc:chat:${COMMERCE_CONVERSATION_ID}:2026-10-27`),
    ).toBe("0");
  });
});

describe("create_document tool", () => {
  function context(userId: string | null, calls: DocumentCall[]): AgentToolContext {
    return {
      conversationId: COMMERCE_CONVERSATION_ID,
      userId,
      market: { currency: "EGP", country: "EG" },
      config: { ...settingDefault("waAgent"), language: "en" },
      now: NOW,
      mediaParts: [],
      handoffReason: null,
      deps: {
        catalog: { catalog: () => Promise.reject(new Error("unused")) },
        account: { status: () => Promise.reject(new Error("unused")) },
        media: { find: () => Promise.resolve(null) },
        mediaOrigin: "",
        handoff: { raise: () => Promise.resolve() },
        ...unusedCommerceDeps,
        documents: {
          create: (call) => {
            calls.push(call);
            return Promise.resolve({ creating: true });
          },
        },
      },
    };
  }
  const bound = (userId: string | null) => {
    const calls: DocumentCall[] = [];
    const records: ToolCallRecord[] = [];
    const ctx = context(userId, calls);
    const { handlers } = bindTools(toolsFor(userId !== null), ctx, records);
    return { handlers, calls, records };
  };

  it("is offered to guests and to linked chats", () => {
    expect(toolsFor(false).map((tool) => tool.definition.name)).toContain("create_document");
    expect(toolsFor(true).map((tool) => tool.definition.name)).toContain("create_document");
  });

  it("hands valid arguments to the service with the chat's language and the sender's link state", async () => {
    const guest = bound(null);
    const args = { template: "report", fileName: "a", content: report().content };
    expect(await guest.handlers["create_document"]?.(args)).toEqual({ creating: true });
    expect(guest.calls[0]).toMatchObject({
      conversationId: COMMERCE_CONVERSATION_ID,
      linked: false,
      language: "en",
    });
    const linked = bound("018f0000-0000-7000-8000-0000000000a1");
    await linked.handlers["create_document"]?.(args);
    expect(linked.calls[0]?.linked).toBe(true);
  });

  it("refuses arguments over the limits without calling the service", async () => {
    const { handlers, calls, records } = bound(null);
    const tooMany = {
      template: "card",
      fileName: "a",
      content: { title: "t", lines: Array.from({ length: 9 }, () => "l") },
    };
    expect(await handlers["create_document"]?.(tooMany)).toEqual({ error: "invalid_arguments" });
    expect(await handlers["create_document"]?.({ template: "poster", fileName: "a" })).toEqual({
      error: "invalid_arguments",
    });
    expect(calls).toHaveLength(0);
    expect(records.every((record) => !record.ok)).toBe(true);
  });

  it("is described in the prompt without relaxing the medical rules", () => {
    const prompt = buildSystemPrompt({
      persona: "",
      language: "ar",
      emojiLevel: "none",
      now: NOW,
      firstName: null,
      currency: "EGP",
      summary: null,
    });
    expect(prompt).toContain("create_document");
    expect(prompt).toContain("قيد التجهيز");
  });
});
