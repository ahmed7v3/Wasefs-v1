import { Inject, Injectable } from "@nestjs/common";
import {
  RedisBreakerStore,
  aiPausedError,
  createAdapter,
  createRouter,
  createSpendGuard,
  type ResolvedRoute,
  type Router,
  type RouterEvent,
  type RouterInput,
  type RouterNote,
  type RouterPorts,
  type SpendGuard,
} from "@wasfa/ai";
import { createAiRuntimePorts, loadAiModels, type DecryptProviderKey } from "@wasfa/db";
import { decryptSecret } from "@wasfa/shared/crypto";
import { isAppError } from "@wasfa/shared/errors";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { DB, type DbHandle } from "../common/database.js";
import { REDIS } from "../common/redis.js";
import { API_ENV } from "../config/config.module.js";
import { encryptionKey, type ApiEnv } from "../config/env.js";
import { SettingsService } from "../settings/settings.service.js";

import { providerKeyContext } from "./provider-key.js";

import type { AiMode, AiTask } from "@wasfa/shared/ai";
import type { SettingValue } from "@wasfa/shared/settings";

type KillSwitch = SettingValue<"ai">["killSwitch"];

/** Which per-feature switch stops a task. Helper tasks (titles, summaries) answer to `all` only. */
function featureSwitch(task: AiTask): keyof Omit<KillSwitch, "all"> | null {
  switch (task) {
    case "rx_extract":
    case "rx_verify":
      return "rx";
    case "chat":
    case "deep_think":
      return "chat";
    case "web_search":
      return "search";
    case "wa_agent":
      return "wa_agent";
    default:
      return null;
  }
}

/** `all`, the task's own switch, or (when asked about search) the search switch. */
export function isSwitchedOff(
  killSwitch: KillSwitch,
  task: AiTask,
  options: { search: boolean },
): boolean {
  if (killSwitch.all) return true;
  if (options.search) return killSwitch.search;
  const feature = featureSwitch(task);
  return feature !== null && killSwitch[feature];
}

/**
 * The API's AI router: the generic `@wasfa/ai` router wired to this deployment's database, Redis,
 * settings (kill switches, daily cap) and provider keys. Features call `run`; they never build
 * adapters or read provider rows themselves.
 */
@Injectable()
export class AiRuntimeService {
  private readonly router: Router;
  private readonly routeLookup: RouterPorts["resolveRoute"];
  private readonly spendGuard: SpendGuard;
  private readonly portsOf: (resolveRoute: RouterPorts["resolveRoute"]) => RouterPorts;
  private readonly decrypt: DecryptProviderKey;
  private readonly db: DbHandle["db"];

  constructor(
    @Inject(DB) handle: DbHandle,
    @Inject(REDIS) redis: Redis,
    @Inject(API_ENV) env: ApiEnv,
    private readonly settings: SettingsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("AiRuntime");
    const limits: RouterPorts["limits"] = async () => {
      const ai = await this.settings.get("ai");
      return { dailyCapUsdMicros: ai.dailyCapUsdMicros, alertPercent: ai.alertPercent };
    };
    this.db = handle.db;
    this.decrypt = (key, enc) => decryptSecret(enc, encryptionKey(env), providerKeyContext(key));
    const { resolveRoute, recordUsage } = createAiRuntimePorts(handle.db, this.decrypt);
    this.routeLookup = resolveRoute;
    this.spendGuard = createSpendGuard(redis, {
      limits,
      // No notifier exists yet: the error log (with a stable event name) is the admin alert.
      onAlert: (alert) => {
        this.logger.error({ event: "ai.spend_alert", ...alert }, "AI daily spend alert");
      },
    });
    const breaker = new RedisBreakerStore(redis);
    // Everything but the route lookup is shared with `runPinned`: same breaker, spend guard, switches.
    this.portsOf = (lookup) => ({
      resolveRoute: lookup,
      recordUsage,
      limits,
      breaker,
      spendGuard: this.spendGuard,
      killSwitch: async (task, options) =>
        isSwitchedOff((await this.settings.get("ai")).killSwitch, task, options),
      adapterFor: (model) =>
        createAdapter(
          {
            kind: model.provider.kind,
            baseUrl: model.provider.baseUrl,
            apiKey: model.provider.apiKey,
            dataPolicy: model.provider.dataPolicy,
          },
          { env: env.NODE_ENV },
        ),
      onNote: (note) => {
        this.note(note);
      },
    });
    this.router = createRouter(this.portsOf(resolveRoute));
  }

  /** Streams the answer and ends with a `result` event; see `Router.run` for the refusals it throws. */
  run(input: RouterInput, signal: AbortSignal): AsyncGenerator<RouterEvent> {
    return this.router.run(input, signal);
  }

  /**
   * Like `run`, but on one model picked by its `ai_models.id` instead of the task's route (the admin
   * playground). It still goes through the kill switches, the spend guard, the free-tier rule and the
   * breaker, and still writes its `ai_usage` row; a model that no longer exists is `no_route`.
   */
  runPinned(
    modelRowId: string,
    input: RouterInput,
    signal: AbortSignal,
  ): AsyncGenerator<RouterEvent> {
    // Version 0 marks usage rows that did not come from a stored route.
    const router = createRouter(
      this.portsOf(async () => {
        const [model] = await loadAiModels(this.db, this.decrypt, [modelRowId]);
        return model ? { routeId: "pinned", version: 0, attempts: [{ model, params: {} }] } : null;
      }),
    );
    return router.run(input, signal);
  }

  /** The route the router would use, for estimating a call's worst-case cost before it starts. */
  route(task: AiTask, planId: string | null, mode: AiMode): Promise<ResolvedRoute | null> {
    return this.routeLookup(task, planId, mode);
  }

  /**
   * The router's first two refusals (kill switches, daily spend cap) asked up front, so a feature
   * can answer with a plain JSON error before it opens a stream. Throws `ai_paused`.
   */
  async assertAvailable(task: AiTask, options: { search: boolean }): Promise<void> {
    const ai = await this.settings.get("ai");
    if (isSwitchedOff(ai.killSwitch, task, { search: false })) throw aiPausedError();
    if (options.search && isSwitchedOff(ai.killSwitch, task, { search: true })) {
      throw aiPausedError();
    }
    try {
      await this.spendGuard.check(ai.dailyCapUsdMicros);
    } catch (error) {
      // A Redis outage must not take the assistant down (the router tolerates it the same way).
      if (isAppError(error)) throw error;
    }
  }

  private note(note: RouterNote): void {
    // Ids and codes only: a note never carries content.
    this.logger.warn({ note }, "AI router note");
  }
}
