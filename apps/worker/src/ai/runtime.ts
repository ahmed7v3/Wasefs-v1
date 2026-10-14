import {
  RedisBreakerStore,
  createAdapter,
  createRouter,
  createSpendGuard,
  type AIProviderAdapter,
  type Router,
  type RouterModel,
  type RouterNote,
  type RouterPorts,
} from "@wasfa/ai";
import { createAiRuntimePorts, type Database } from "@wasfa/db";
import { decodeEncryptionKey, decryptSecret } from "@wasfa/shared/crypto";
import { isAiSwitchedOff } from "@wasfa/shared/settings";

import { readSetting } from "../settings.js";

import type { WorkerEnv } from "../config/env.js";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

/** The AAD a provider key was sealed with: must equal the API's `providerKeyContext`. */
export const providerKeyContext = (providerKey: string): string => `ai_provider:${providerKey}`;

export interface AiRuntime {
  router: Router;
}

export interface AiRuntimeDeps {
  env: Pick<WorkerEnv, "ENCRYPTION_KEY" | "NODE_ENV">;
  db: Database;
  redis: Redis;
  logger: Logger;
  /** Tests replace the adapter factory (a scripted fake instead of a real provider). */
  adapterFor?: (model: RouterModel) => AIProviderAdapter;
}

/**
 * The worker's AI router: the same `@wasfa/ai` router and database ports as the API, wired to the
 * worker's database, Redis (breaker and daily spend), `ai` setting (cap, kill switches) and the
 * same `ENCRYPTION_KEY` for provider keys. Nothing here keeps a prompt or an answer.
 */
export function createAiRuntime({ env, db, redis, logger, adapterFor }: AiRuntimeDeps): AiRuntime {
  const key = decodeEncryptionKey(env.ENCRYPTION_KEY);
  const limits: RouterPorts["limits"] = async () => {
    const ai = await readSetting(db, "ai");
    return { dailyCapUsdMicros: ai.dailyCapUsdMicros, alertPercent: ai.alertPercent };
  };
  const { resolveRoute, recordUsage } = createAiRuntimePorts(db, (providerKey, enc) =>
    decryptSecret(enc, key, providerKeyContext(providerKey)),
  );
  const router = createRouter({
    resolveRoute,
    recordUsage,
    limits,
    breaker: new RedisBreakerStore(redis),
    spendGuard: createSpendGuard(redis, {
      limits,
      onAlert: (alert) => {
        logger.error({ event: "ai.spend_alert", ...alert }, "AI daily spend alert");
      },
    }),
    killSwitch: async (task, options) =>
      isAiSwitchedOff((await readSetting(db, "ai")).killSwitch, task, options),
    adapterFor:
      adapterFor ??
      ((model) =>
        createAdapter(
          {
            kind: model.provider.kind,
            baseUrl: model.provider.baseUrl,
            apiKey: model.provider.apiKey,
            dataPolicy: model.provider.dataPolicy,
          },
          { env: env.NODE_ENV },
        )),
    onNote: (note: RouterNote) => {
      // Ids and codes only: a note never carries content.
      logger.warn({ note }, "AI router note");
    },
  });
  return { router };
}
