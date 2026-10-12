import { Inject, Injectable } from "@nestjs/common";
import {
  RedisBreakerStore,
  createAdapter,
  createRouter,
  createSpendGuard,
  type Router,
  type RouterEvent,
  type RouterInput,
  type RouterNote,
  type RouterPorts,
} from "@wasfa/ai";
import { createAiRuntimePorts } from "@wasfa/db";
import { decryptSecret } from "@wasfa/shared/crypto";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { DB, type DbHandle } from "../common/database.js";
import { REDIS } from "../common/redis.js";
import { API_ENV } from "../config/config.module.js";
import { encryptionKey, type ApiEnv } from "../config/env.js";
import { SettingsService } from "../settings/settings.service.js";

import { providerKeyContext } from "./provider-key.js";

import type { AiTask } from "@wasfa/shared/ai";
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
    const { resolveRoute, recordUsage } = createAiRuntimePorts(handle.db, (key, enc) =>
      decryptSecret(enc, encryptionKey(env), providerKeyContext(key)),
    );
    this.router = createRouter({
      resolveRoute,
      recordUsage,
      limits,
      breaker: new RedisBreakerStore(redis),
      spendGuard: createSpendGuard(redis, {
        limits,
        // No notifier exists yet: the error log (with a stable event name) is the admin alert.
        onAlert: (alert) => {
          this.logger.error({ event: "ai.spend_alert", ...alert }, "AI daily spend alert");
        },
      }),
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
  }

  /** Streams the answer and ends with a `result` event; see `Router.run` for the refusals it throws. */
  run(input: RouterInput, signal: AbortSignal): AsyncGenerator<RouterEvent> {
    return this.router.run(input, signal);
  }

  private note(note: RouterNote): void {
    // Ids and codes only: a note never carries content.
    this.logger.warn({ note }, "AI router note");
  }
}
