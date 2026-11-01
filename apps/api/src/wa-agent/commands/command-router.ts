import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { isActive } from "@wasfa/shared/wa-agent/session";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { AuditService } from "../../audit/audit.service.js";
import { REDIS } from "../../common/redis.js";
import { ObjectStorage } from "../../files/object-storage.js";
import { SettingsService } from "../../settings/settings.service.js";
import { AgentAccountService } from "../agent/account-facts.service.js";
import { phoneMarket } from "../agent/agent-market.js";
import { WaAgentHandoffService, handoffFlagKey } from "../agent/handoff.service.js";
import { ToolEffectsRepo } from "../agent/tools/tool-effects.repo.js";
import { AttachmentsService } from "../conversation/attachments.service.js";
import { WaAgentRepo } from "../conversation/conversation.repo.js";
import { localeOf, withProfile } from "../conversation/profile-config.js";
import { SessionService } from "../conversation/session.service.js";
import { WaAgentStateService } from "../conversation/state.service.js";
import { AgentRxService } from "../rx/agent-rx.service.js";
import { RxStartService } from "../rx/rx-start.service.js";
import { WaOutboundService } from "../transport/outbound.service.js";
import { StaleFenceError } from "../turn/lock.js";
import { TurnStore, type ActiveTurn } from "../turn/turn.store.js";

import { stateOf } from "./command-intent.js";
import { CommandLimits } from "./command-limits.js";
import { planSteps } from "./command-plan.js";
import { CommandsRepo } from "./commands.repo.js";
import { HANDLERS } from "./handlers/index.js";

import type { CommandDeps, CommandHandler, CommandInput, CommandStep } from "./command-types.js";
import type { TurnTraceStep } from "../turn/agent-round.js";
import type { WaConversation, TurnMessage } from "@wasfa/db";
import type { WaCommand } from "@wasfa/shared/i18n/wa-commands";
import type { WaAgentOutboundPart } from "@wasfa/shared/schemas/wa-agent";
import type { WaAgentSettings } from "@wasfa/shared/settings";

/** `done`: the leading command rows were answered; `none`: nothing to do here, the model takes every row. */
export type CommandRun = "none" | "done" | "stale";

/** What the router needs from the module; the real services fit, tests pass fakes. */
export interface CommandRouterPorts {
  conversations: Pick<WaAgentRepo, "find">;
  sessions: Pick<SessionService, "state">;
  store: Pick<TurnStore, "begin" | "close">;
  outbound: Pick<WaOutboundService, "enqueueFenced">;
  limits: Pick<CommandLimits, "allow">;
  handoff: Pick<WaAgentHandoffService, "pauseWhenDelivered">;
  /** True while the owner asked to take over and the pause is not on yet. */
  handoffFlag: (conversationId: string) => Promise<boolean>;
  deps: CommandDeps;
  handlers: Record<WaCommand, CommandHandler>;
  logger: Pick<PinoLogger, "info">;
}

/**
 * The deterministic command layer of the v2 turn (docs/WA-AGENT-RUNTIME.md §7, §18.4). Under the conversation
 * lock and fence, `run` takes the contiguous leading command rows of the unanswered messages, answers each
 * with its handler (no model, no cost), queues their replies in one fenced write and links exactly those
 * rows to the turn. Everything from the first non-command row on is left unanswered: the runner's next
 * round gives it to the model. A turn that is only commands never calls a model.
 */
@Injectable()
export class CommandRouter {
  private readonly ports: CommandRouterPorts;

  constructor(
    conversations: WaAgentRepo,
    sessions: SessionService,
    store: TurnStore,
    outbound: WaOutboundService,
    handoff: WaAgentHandoffService,
    settings: SettingsService,
    attachments: AttachmentsService,
    agentRx: AgentRxService,
    rxStart: RxStartService,
    effects: ToolEffectsRepo,
    account: AgentAccountService,
    repo: CommandsRepo,
    storage: ObjectStorage,
    audit: AuditService,
    @Inject(REDIS) redis: Redis,
    logger: PinoLogger,
  ) {
    logger.setContext("WaAgentCommands");
    this.ports = {
      conversations,
      sessions,
      store,
      outbound,
      handoff,
      limits: new CommandLimits(redis),
      handoffFlag: async (id) => (await redis.exists(handoffFlagKey(id))) === 1,
      handlers: HANDLERS,
      logger,
      deps: {
        sessions,
        attachments,
        rx: {
          startBase: (call) => agentRx.startBase(call),
          start: (call, effect, base, picked) => rxStart.analyzeOnce(call, effect, base, picked),
        },
        effects,
        account: { status: (userId, now) => account.status(userId, now) },
        handoff,
        store: repo,
        storage: { remove: (key) => storage.remove(key) },
        audit,
        market: async (conversation) =>
          phoneMarket(conversation.phone, await settings.get("currency")),
      },
    };
  }

  /** Ports given directly: how tests build a router. */
  static of(ports: CommandRouterPorts): CommandRouter {
    const router = Object.create(CommandRouter.prototype) as { ports: CommandRouterPorts };
    router.ports = ports;
    return router as unknown as CommandRouter;
  }

  async run(
    conversation: WaConversation,
    unanswered: readonly TurnMessage[],
    fence: number,
    config: WaAgentSettings,
    now: Date = new Date(),
  ): Promise<CommandRun> {
    const { sessions, store, outbound, limits, logger } = this.ports;
    // A chat the agent must stay out of (off, paused, blocked, handed over) is the round's quiet path.
    if (!config.commands.enabled || !config.enabled || conversation.status === "blocked") {
      return "none";
    }
    if (
      WaAgentStateService.isHeld(conversation, now.getTime()) ||
      (await this.ports.handoffFlag(conversation.id))
    ) {
      return "none";
    }
    const state =
      conversation.sessionId === null ? {} : await sessions.state(conversation.sessionId);
    const steps = await planSteps(unanswered, {
      state: stateOf(state, now),
      awaitingRx: isActive(state.awaitingRx, now),
      aliases: config.commands.extraAliases,
      maxSteps: Math.max(1, Math.floor(config.caps.maxMessagesPerTurn / 2)),
      allow: (command, confirming) => limits.allow(conversation.id, command, confirming),
    });
    if (steps.length === 0) return "none";

    const ids = new Set(steps.flatMap((step) => step.rowIds));
    const turn = await store.begin(
      conversation.id,
      fence,
      unanswered.filter((row) => ids.has(row.id)),
    );
    const parts: WaAgentOutboundPart[] = [];
    const trace: TurnTraceStep[] = [];
    let handoffReason: string | undefined;
    try {
      for (const step of steps) {
        const result = await this.answer(conversation, turn, config, now, step);
        parts.push(...result.parts);
        trace.push({ code: "command", name: step.command, via: step.via });
        handoffReason = result.handoffReason ?? handoffReason;
      }
    } catch (error) {
      if (error instanceof StaleFenceError) return "stale";
      throw error;
    }

    const end = { turnId: turn.id, fence, inboundIds: turn.inboundIds, costUsdMicros: 0, trace };
    try {
      const messageIds = await outbound.enqueueFenced(
        conversation.id,
        parts.slice(0, config.caps.maxMessagesPerTurn),
        end,
      );
      if (handoffReason !== undefined) {
        this.ports.handoff.pauseWhenDelivered(conversation.id, messageIds);
      }
    } catch (error) {
      if (error instanceof StaleFenceError) return "stale";
      if (!isRefusal(error)) throw error;
      // Paused, blocked or switched off while the handlers ran: the reply is not wanted any more.
      logger.info({ conversationId: conversation.id, turnId: turn.id }, "Command reply not queued");
      await store.close(turn, { ...end, causeClass: "policy" }, "dropped_policy");
    }
    return "done";
  }

  /** One step: the chat is read fresh (an earlier step may have changed the session or the profile). */
  private async answer(
    first: WaConversation,
    turn: ActiveTurn,
    config: WaAgentSettings,
    now: Date,
    step: CommandStep,
  ) {
    const { conversations, deps, handlers } = this.ports;
    const conversation = (await conversations.find(first.id)) ?? first;
    if (step.via === "menu" && conversation.sessionId !== null) {
      await deps.sessions.clearState(conversation.sessionId, "menu");
    }
    const input: CommandInput = {
      conversation,
      turn: { id: turn.id, fence: turn.fence },
      config: withProfile(config, conversation.profile),
      now,
      locale: localeOf(config, conversation.profile),
      step,
    };
    return handlers[step.command](input, deps);
  }
}

const isRefusal = (error: unknown): boolean =>
  error instanceof AppError && error.code === ErrorCode.CONFLICT;
