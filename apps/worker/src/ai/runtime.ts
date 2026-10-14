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
import { createAiRuntimePorts, loadAiModels, type Database, type RuntimeModel } from "@wasfa/db";
import { decodeEncryptionKey, decryptSecret } from "@wasfa/shared/crypto";
import { isAiSwitchedOff } from "@wasfa/shared/settings";

import { readSetting } from "../settings.js";

import type { WorkerEnv } from "../config/env.js";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

/** The AAD a provider key was sealed with: must equal the API's `providerKeyContext`. */
export const providerKeyContext = (providerKey: string): string => `ai_provider:${providerKey}`;

/** Wraps the route lookup of a router: sees the lookup it replaces and answers instead of it. */
export type RouteRewrite = (inner: RouterPorts["resolveRoute"]) => RouterPorts["resolveRoute"];

export interface AiRuntime {
  router: Router;
  /**
   * A router identical to `router` (same breaker, spend guard, kill switch and usage rows) whose
   * route lookup is rewritten. Accuracy runs use it to call a frozen list of models.
   */
  routerWith(rewrite: RouteRewrite): Router;
  /** Models by id with their decrypted provider keys (see `loadAiModels`). */
  loadModels(ids: readonly string[]): Promise<RuntimeModel[]>;
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
  const decrypt = (providerKey: string, enc: string): string =>
    decryptSecret(enc, key, providerKeyContext(providerKey));
  const { resolveRoute, recordUsage } = createAiRuntimePorts(db, decrypt);
  const buildRouter = (rewrite?: RouteRewrite): Router =>
    createRouter({
      resolveRoute: rewrite === undefined ? resolveRoute : rewrite(resolveRoute),
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
  return {
    router: buildRouter(),
    routerWith: buildRouter,
    loadModels: (ids) => loadAiModels(db, decrypt, ids),
  };
}
