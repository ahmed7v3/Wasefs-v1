import { randomUUID } from "node:crypto";

import { type FakeScript, type RouterInput } from "@wasfa/ai";
import {
  files,
  grant,
  rxAnalyses,
  users,
  waConversations,
  waMessages,
  type WaConversation,
  type WaMessage,
} from "@wasfa/db";
import { WA_AGENT_OUT_STREAM } from "@wasfa/shared/schemas/phone";
import {
  type WaAgentEvent,
  type WaAgentInbound,
  type WaAgentOutEntry,
  type WaAgentOutboundPart,
} from "@wasfa/shared/schemas/wa-agent";
import { type WaAgentSettings } from "@wasfa/shared/settings";
import { and, asc, eq, sql } from "drizzle-orm";

import { ErrorReporter } from "../../../src/common/errors.js";
import { CreditsService } from "../../../src/credits/credits.service.js";
import { ObjectStorage } from "../../../src/files/object-storage.js";
import { PlansService } from "../../../src/plans/plans.service.js";
import { RxService } from "../../../src/rx/rx.service.js";
import { SettingsService } from "../../../src/settings/settings.service.js";
import {
  WaAgentHandoffService,
  handoffFlagKey,
} from "../../../src/wa-agent/agent/handoff.service.js";
import { WaAgentToolDeps } from "../../../src/wa-agent/agent/tool-deps.js";
import { WaAgentTurnService } from "../../../src/wa-agent/agent/wa-agent-turn.service.js";
import { WaAgentCommerceRepo } from "../../../src/wa-agent/commerce/agent-commerce.repo.js";
import { AgentRxService } from "../../../src/wa-agent/commerce/agent-rx.service.js";
import { WaAgentEventsConsumer } from "../../../src/wa-agent/commerce/wa-agent-events.consumer.js";
import { FailureActions } from "../../../src/wa-agent/turn/failure-actions.js";
import { OutboxDeliverer } from "../../../src/wa-agent/outbox/deliverer.js";
import { WaOutboxRepo } from "../../../src/wa-agent/outbox/wa-outbox.repo.js";
import { ConversationLock } from "../../../src/wa-agent/turn/lock.js";
import { TurnRunner } from "../../../src/wa-agent/turn/turn-runner.js";
import { TurnStore } from "../../../src/wa-agent/turn/turn.store.js";
import { WaAgentVoiceService } from "../../../src/wa-agent/voice/voice.service.js";
import { WaAgentStateService } from "../../../src/wa-agent/wa-agent-state.service.js";
import { WaAgentRepo } from "../../../src/wa-agent/wa-agent.repo.js";
import { WaOutboundService } from "../../../src/wa-agent/wa-outbound.service.js";
import { AdminTestContext } from "../../support/admin-context.js";
import { fakeAi, silentLogger, type FakeAi } from "../../support/wa-agent-fakes.js";

import { TINY_JPEG } from "./fixtures.js";

import type { FilesService } from "../../../src/files/files.service.js";
import type { AgentCall } from "../../../src/wa-agent/agent/tools/index.js";
import type { AgentRound } from "../../../src/wa-agent/turn/agent-round.js";
import type { TurnEnqueuer } from "../../../src/wa-agent/turn/turn.queue.js";

/*
 * The WhatsApp agent scenario harness (docs/WA-AGENT-RUNTIME.md section 15). A scenario is a typed
 * script: a customer who sends messages and pictures, a scripted model, and assertions on what was
 * queued for the customer and what was stored. Typed TypeScript instead of YAML (no new dependency,
 * refactor-safe): a recorded deviation from section 15.
 *
 * Real: Postgres, Redis, the transcript, the outbound queue, the pause, the account, the credits and
 * the prescription request. Fake: the model (scripted), the object storage (in memory) and the image
 * worker (a page is "processed" at once). The runtime that drives the turns is a seam
 * (`ScenarioRuntime`): today the v1 inline turn service, later the v2 queue, with the same scenarios.
 */

/** One part queued for the customer on `wa:agent:out`. */
export type OutPart = WaAgentOutboundPart;

export interface InboundMessage {
  text?: string;
  image?: Buffer;
  /** Defaults to `image/jpeg`. */
  imageMime?: string;
  document?: { bytes: Buffer; mime: string; fileName?: string };
  /** Text that comes with the picture or the file. */
  caption?: string;
  /** How long ago the customer sent it (default: now). */
  ageMinutes?: number;
}

/** Drives the agent until it has nothing left to do for the messages received so far. */
export interface ScenarioRuntime {
  runTurns(scenario: Scenario): Promise<void>;
}

export interface ScenarioOptions {
  /** A chat whose number belongs to a verified account (default: a guest). */
  linked?: boolean;
  /** Extra credits granted to the linked account (new accounts already get their free ones). */
  credits?: number;
  settings?: Partial<WaAgentSettings>;
  model: FakeScript;
  runtime?: ScenarioRuntime;
  /** Cost the router reports per model call, USD micros. */
  costUsdMicros?: number;
}

/** A reading result the way `RxService.get` returns it, one medicine. */
const RX_VIEW = {
  result: {
    schemaVersion: 1,
    items: [
      {
        rawText: "panadol 500",
        name: "Panadol",
        matchedDrugId: null,
        matchScore: null,
        activeIngredients: [],
        strength: "500 mg",
        form: "أقراص",
        dose: "قرص",
        frequency: "كل 8 ساعات",
        duration: null,
        route: null,
        notes: null,
        confidence: 0.9,
        badge: "high",
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
};

const MINUTE_MS = 60_000;
let counter = 0;

function uniquePhone(): string {
  counter += 1;
  return `+2010${String(70_000_000 + ((counter * 7919) % 20_000_000))}`;
}

function mediaKey(): string {
  const now = new Date();
  return `wa/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
}

export class Scenario {
  /** The account of a linked scenario. */
  userId: string | null = null;
  readonly phone = uniquePhone();
  readonly jid = `${this.phone.slice(1)}@s.whatsapp.net`;
  /** The v1 turn service of this chat (a v2 runtime may leave it unused). */
  readonly turns: WaAgentTurnService;
  /** Inbound messages stored since the runtime last ran (the consumer starts one turn per message). */
  unprocessed = 0;
  private id: string | null = null;
  private readonly storage = new Map<string, Buffer>();

  private constructor(
    readonly ctx: AdminTestContext,
    private readonly ai: FakeAi,
    private readonly runtime: ScenarioRuntime,
    readonly services: ScenarioServices,
  ) {
    this.turns = services.makeTurns(ai, this.storage);
  }

  static async start(ctx: AdminTestContext, options: ScenarioOptions): Promise<Scenario> {
    const services = new ScenarioServices(ctx);
    await services.settings.set(
      "waAgent",
      { enabled: true, guestsEnabled: true, spendCapUsdMicros: 5_000_000, ...options.settings },
      { actorId: null },
    );
    await ctx.redis.del(
      `wa:agent:spend:${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`,
    );
    services.handoff.timing.pollMs = 5;
    services.handoff.timing.sleep = (ms) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });

    const ai = fakeAi(
      options.model,
      options.costUsdMicros === undefined ? {} : { costUsdMicros: options.costUsdMicros },
    );
    const scenario = new Scenario(ctx, ai, options.runtime ?? new V1Runtime(), services);
    if (options.linked === true) await scenario.linkAccount(options.credits);
    return scenario;
  }

  get conversationId(): string {
    if (this.id === null) throw new Error("the customer has not written yet");
    return this.id;
  }

  private async linkAccount(credits: number | undefined): Promise<void> {
    const [row] = await this.ctx.owner.db
      .insert(users)
      .values({
        name: "Mona Ali",
        email: `${randomUUID()}@example.com`,
        phone: this.phone,
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
        status: "active",
      })
      .returning({ id: users.id });
    if (!row) throw new Error("user not created");
    this.userId = row.id;
    if (credits !== undefined && credits > 0) {
      await grant(this.ctx.owner.db, { type: "user", id: row.id }, credits, "2026-10");
    }
  }

  /** The customer sends a message; returns the stored row's id. */
  async inbound(message: InboundMessage): Promise<string> {
    const waMessageId = randomUUID();
    const ts = Date.now() - (message.ageMinutes ?? 0) * MINUTE_MS;
    const file = message.image
      ? { bytes: message.image, mime: message.imageMime ?? "image/jpeg", kind: "image" as const }
      : message.document
        ? { bytes: message.document.bytes, mime: message.document.mime, kind: "document" as const }
        : null;
    const entry: WaAgentInbound = {
      waMessageId,
      jid: this.jid,
      phone: this.phone,
      direction: "in",
      kind: file?.kind ?? "text",
      ts,
    };
    const text = file ? message.caption : message.text;
    if (text !== undefined) entry.text = text;
    if (file) {
      const key = mediaKey();
      this.storage.set(key, file.bytes);
      entry.media = { key, mime: file.mime, bytes: file.bytes.length };
    }
    const { conversation } = await this.services.repo.ingest(
      entry,
      new Date(Date.now() + 60 * MINUTE_MS),
    );
    this.id = conversation.id;
    await this.services.state.mirror(conversation);
    this.unprocessed += 1;
    const [row] = await this.ctx.owner.db
      .select({ id: waMessages.id })
      .from(waMessages)
      .where(eq(waMessages.waMessageId, waMessageId));
    if (!row) throw new Error("message not stored");
    return row.id;
  }

  /** Drives the runtime until it is idle, then lets the bridge report the queued parts as sent. */
  async runTurns(): Promise<void> {
    await this.runtime.runTurns(this);
  }

  /** The healthy bridge: queued parts are delivered, then the pauses that waited for that apply. */
  async deliver(): Promise<void> {
    await this.ctx.owner.db
      .update(waMessages)
      .set({ status: "sent" })
      .where(
        and(
          eq(waMessages.conversationId, this.conversationId),
          eq(waMessages.direction, "out"),
          eq(waMessages.status, "queued"),
        ),
      );
    await this.services.handoff.drain();
    await this.turns.drain();
  }

  /** Everything queued for this chat on `wa:agent:out`, in order. */
  async outbound(): Promise<OutPart[]> {
    if (this.id === null) return [];
    const entries = await this.ctx.redis.xrange(WA_AGENT_OUT_STREAM, "-", "+");
    const parts: OutPart[] = [];
    for (const [, fields] of entries) {
      const index = fields.indexOf("data");
      if (index < 0) continue;
      const entry = JSON.parse(fields[index + 1] ?? "null") as WaAgentOutEntry | null;
      if (entry?.conversationId === this.id) parts.push(...entry.parts);
    }
    return parts;
  }

  async outboundTexts(): Promise<string[]> {
    return (await this.outbound()).flatMap((part) => (part.kind === "text" ? [part.text] : []));
  }

  /** A result event from the worker, through the real events consumer (the reading itself is a fixed fake). */
  async workerEvent(event: WaAgentEvent): Promise<void> {
    await this.services.eventsConsumer().process(event);
    // v2 routes the result through wa_outbox; the deliverer's timer is off in tests.
    await this.services.deliverer().sweep();
  }

  /** The owner types into the chat from the phone: the agent is paused. */
  async ownerPause(): Promise<void> {
    const entry: WaAgentInbound = {
      waMessageId: randomUUID(),
      jid: this.jid,
      phone: this.phone,
      direction: "owner",
      kind: "text",
      text: "أنا هتكلم معاك",
      ts: Date.now(),
    };
    const { conversation } = await this.services.repo.ingest(
      entry,
      new Date(Date.now() + 60 * MINUTE_MS),
    );
    await this.services.state.mirror(conversation);
  }

  /** An admin resumes the chat: the pause and the handoff flag are gone. */
  async ownerResume(): Promise<void> {
    await this.services.state.resume(this.conversationId);
    await this.ctx.redis.del(handoffFlagKey(this.conversationId));
  }

  /** Time passes: everything stored for this chat so far becomes `minutes` older. */
  async passTime(minutes: number): Promise<void> {
    const interval = sql`${minutes} * interval '1 minute'`;
    await this.ctx.owner.db
      .update(waMessages)
      .set({ createdAt: sql`${waMessages.createdAt} - ${interval}` })
      .where(eq(waMessages.conversationId, this.conversationId));
    await this.ctx.owner.db
      .update(waConversations)
      .set({ lastInboundAt: sql`${waConversations.lastInboundAt} - ${interval}` })
      .where(eq(waConversations.id, this.conversationId));
  }

  /** What the model was asked, in order. */
  modelInputs(): RouterInput[] {
    return this.ai.inputs;
  }

  /** The text parts of the messages the model saw on its `call`-th request (0-based), one string. */
  modelSaw(call: number): string {
    const request = this.ai.inputs[call]?.request;
    return (request?.messages ?? [])
      .flatMap((message) =>
        message.role === "tool"
          ? [message.content]
          : message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])),
      )
      .join("\n");
  }

  /** How many picture parts the model saw on its `call`-th request. */
  imagesSeen(call: number): number {
    const request = this.ai.inputs[call]?.request;
    return (request?.messages ?? []).reduce(
      (total, message) =>
        message.role === "tool"
          ? total
          : total + message.parts.filter((part) => part.type === "image").length,
      0,
    );
  }

  async rows(): Promise<WaMessage[]> {
    return this.ctx.owner.db
      .select()
      .from(waMessages)
      .where(eq(waMessages.conversationId, this.conversationId))
      .orderBy(asc(waMessages.createdAt), asc(waMessages.id));
  }

  async inboundRows(): Promise<WaMessage[]> {
    return (await this.rows()).filter((row) => row.direction === "in");
  }

  async outboundRows(): Promise<WaMessage[]> {
    return (await this.rows()).filter((row) => row.direction === "out");
  }

  async conversation(): Promise<WaConversation> {
    const [row] = await this.ctx.owner.db
      .select()
      .from(waConversations)
      .where(eq(waConversations.id, this.conversationId));
    if (!row) throw new Error("conversation not found");
    return row;
  }

  /** The prescription readings of the linked account, oldest first. */
  async readings(): Promise<string[]> {
    if (this.userId === null) return [];
    const rows = await this.ctx.owner.db
      .select({ id: rxAnalyses.id })
      .from(rxAnalyses)
      .where(eq(rxAnalyses.ownerUserId, this.userId))
      .orderBy(asc(rxAnalyses.createdAt), asc(rxAnalyses.id));
    return rows.map((row) => row.id);
  }
}

/** The app's services a scenario needs, plus the builders of the pieces that must be faked. */
export class ScenarioServices {
  readonly repo: WaAgentRepo;
  readonly settings: SettingsService;
  readonly outbound: WaOutboundService;
  readonly handoff: WaAgentHandoffService;
  readonly state: WaAgentStateService;

  constructor(private readonly ctx: AdminTestContext) {
    this.repo = ctx.app.get(WaAgentRepo);
    this.settings = ctx.app.get(SettingsService);
    this.outbound = ctx.app.get(WaOutboundService);
    this.handoff = ctx.app.get(WaAgentHandoffService);
    this.state = ctx.app.get(WaAgentStateService);
  }

  /** The v1 turn service for one chat: real everything but the model, the storage and the image worker. */
  makeTurns(ai: FakeAi, storage: Map<string, Buffer>): WaAgentTurnService {
    const { ctx } = this;
    const fakeStorage = {
      getBytes: (key: string) => {
        const bytes = storage.get(key);
        return bytes
          ? Promise.resolve(new Uint8Array(bytes))
          : Promise.reject(new Error("missing"));
      },
    } as unknown as ObjectStorage;
    const real = ctx.app.get(WaAgentToolDeps);
    const reading = new AgentRxService(
      ctx.app.get(WaAgentCommerceRepo),
      this.processedFiles(),
      ctx.app.get(RxService),
      ctx.app.get(PlansService),
      ctx.app.get(CreditsService),
      this.settings,
      ctx.redis,
      silentLogger,
    );
    // Only the reading is replaced: the real one would copy the picture from the bucket.
    const deps = Object.create(real, {
      usage: {
        value: {
          analyzePrescription: (call: AgentCall) => reading.analyze(call),
          askMedical: real.usage.askMedical,
        },
      },
    }) as WaAgentToolDeps;
    const service = new WaAgentTurnService(
      this.repo,
      this.settings,
      ctx.redis,
      ai.service,
      this.outbound,
      this.handoff,
      deps,
      ctx.app.get(PlansService),
      fakeStorage,
      silentLogger,
      ctx.app.get(WaAgentVoiceService),
    );
    // No waiting: the rows are already there, and a retry pause is not worth real seconds.
    service.timing.quietMs = 0;
    service.timing.maxQuietWaitMs = 0;
    service.timing.sleep = () => Promise.resolve();
    return service;
  }

  /** The image worker, instant: an imported picture is a processed page of the viewer. */
  private processedFiles(): FilesService {
    const { ctx } = this;
    return {
      importObject: async (viewer: { id: string }) => {
        const id = randomUUID();
        await ctx.owner.db.insert(files).values({
          id,
          ownerUserId: viewer.id,
          createdBy: viewer.id,
          purpose: "rx_page",
          r2Key: `test/${id}.jpg`,
          mime: "image/jpeg",
          bytes: TINY_JPEG.length,
          sha256: randomUUID().replaceAll("-", "").padEnd(64, "b"),
          dhash: "0123456789abcdef",
          status: "processed",
        });
        return id;
      },
      awaitProcessed: () => Promise.resolve("processed" as const),
    } as unknown as FilesService;
  }

  /** The v2 runner: real lock, store, fencing and outbound; `round` is the thinking part, `queue` the re-enqueue sink. */
  makeRunner(round: AgentRound, queue: TurnEnqueuer): TurnRunner {
    const { ctx } = this;
    const store = ctx.app.get(TurnStore);
    const failures = new FailureActions(
      ctx.redis,
      store,
      this.outbound,
      round,
      queue,
      this.handoff,
      ctx.app.get(ErrorReporter),
      silentLogger,
    );
    return new TurnRunner(
      new ConversationLock(ctx.redis),
      store,
      this.repo,
      this.settings,
      round,
      this.outbound,
      queue,
      failures,
      silentLogger,
    );
  }

  /** The app's outbox deliverer (its timer is off in tests: scenarios call `sweep()`). */
  deliverer(): OutboxDeliverer {
    const deliverer = this.ctx.app.get(OutboxDeliverer);
    deliverer.timing.lockWaitMs = 0;
    return deliverer;
  }

  /** The real follow-up consumer; only the reading it prints is fixed (`RX_VIEW`). */
  eventsConsumer(): WaAgentEventsConsumer {
    const { ctx } = this;
    const consumer = new WaAgentEventsConsumer(
      ctx.env,
      silentLogger,
      this.repo,
      ctx.app.get(WaAgentCommerceRepo),
      this.outbound,
      { get: () => Promise.resolve(RX_VIEW) } as unknown as RxService,
      this.settings,
      ctx.redis,
      { remove: () => Promise.resolve() } as unknown as ObjectStorage,
      ctx.app.get(WaOutboxRepo),
      this.deliverer(),
    );
    consumer.timing.lockWaitMs = 0;
    return consumer;
  }
}

/**
 * v1: the stream consumer's way. One serial lane per api process (the consumer awaits each entry before
 * the next), one `onInbound` per stored message, errors logged and swallowed, held chats skipped. Share
 * one instance between scenarios to put their chats on the same lane.
 */
export class V1Runtime implements ScenarioRuntime {
  private lane: Promise<void> = Promise.resolve();

  runTurns(scenario: Scenario): Promise<void> {
    const run = this.lane.then(() => this.drive(scenario));
    this.lane = run.catch(() => undefined);
    return run;
  }

  private async drive(scenario: Scenario): Promise<void> {
    const { repo, settings } = scenario.services;
    const count = scenario.unprocessed;
    scenario.unprocessed = 0;
    for (let index = 0; index < count; index++) {
      const config = await settings.get("waAgent");
      const conversation = await repo.find(scenario.conversationId);
      if (!config.enabled || !conversation || WaAgentStateService.isHeld(conversation)) continue;
      try {
        await scenario.turns.onInbound(scenario.conversationId);
      } catch {
        // The consumer logs and moves on; so does the lane.
      }
    }
    await scenario.deliver();
  }
}

/**
 * v2: what the queue worker does, without the clock. Each `runTurns` is one job for the chat (`attempts`
 * runs at most, BullMQ's retry with the backoff skipped); the runner's own re-enqueues (a message that
 * arrived while it worked, a busy lock) run as the next job. Chats are independent: no shared lane.
 */
export class V2Runtime implements ScenarioRuntime {
  /** Conversation ids the runner asked to queue again, since the last pass. */
  readonly requeued: string[] = [];
  /** Errors of jobs that exhausted their attempts (the worker would log them). */
  readonly failures: unknown[] = [];

  constructor(private readonly options: { attempts?: number } = {}) {}

  /** The runner of this chat, wired to the harness' re-enqueue recorder. */
  runner(scenario: Scenario): TurnRunner {
    return scenario.services.makeRunner(scenario.turns, {
      enqueue: (conversationId) => {
        this.requeued.push(conversationId);
        return Promise.resolve();
      },
    });
  }

  async runTurns(scenario: Scenario): Promise<void> {
    scenario.unprocessed = 0;
    const { settings } = scenario.services;
    const current = await settings.get("waAgent");
    await settings.set(
      "waAgent",
      { ...current, runtime: { ...current.runtime, v2: true } },
      { actorId: null },
    );
    const runner = this.runner(scenario);
    const attempts = this.options.attempts ?? 1;
    for (let pass = 0; pass < 5; pass++) {
      this.requeued.length = 0;
      await this.job(runner, scenario.conversationId, attempts);
      if (!this.requeued.includes(scenario.conversationId)) break;
    }
    await scenario.deliver();
  }

  private async job(runner: TurnRunner, conversationId: string, attempts: number): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await runner.run(conversationId);
        return;
      } catch (error) {
        if (attempt >= attempts) {
          this.failures.push(error);
          return;
        }
      }
    }
  }
}
