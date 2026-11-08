import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { GROWTH_PROMPT_KINDS, modalAllowed } from "@wasfa/shared/growth";
import { PROMPT_PLACEHOLDERS, resolvePromptCatalog } from "@wasfa/shared/growth-prompts";
import { t } from "@wasfa/shared/i18n";

import { PromptCopyService } from "../../growth/prompt-copy.service.js";
import { SettingsService } from "../../settings/settings.service.js";

import { AdminPromptsRepo } from "./admin-prompts.repo.js";

import type { GrowthPromptKind } from "@wasfa/shared/growth";
import type { PromptEntry } from "@wasfa/shared/growth-prompts";
import type {
  AdminPromptPreview,
  AdminPromptView,
  AdminPromptsResponse,
} from "@wasfa/shared/schemas/growth";
import type { FastifyRequest } from "fastify";

const DAY_MS = 86_400_000;
const COUNT_DAYS = 30;

/** Example numbers for the placeholders a moment fills itself, so the preview reads like the real card. */
const SAMPLE_PARAMS = {
  count: 3,
  used: 14,
  total: 20,
  left: 6,
  credits: 8,
  days: 3,
  members: 4,
  date: "2026-12-01",
} as const;

/**
 * The prompts console (home-ads-conversion, D7): list with 30-day counts, edit one entry, preview it
 * with the real plan values. The catalog lives in the `growth` setting, so a save goes through
 * `SettingsService.set` (schema validation, cache invalidation, `setting.update` audit row); the
 * claims lint and the modal rule are checked first so the refusal names the term or the key.
 */
@Injectable()
export class AdminPromptsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly copy: PromptCopyService,
    private readonly repo: AdminPromptsRepo,
  ) {}

  async list(now = new Date()): Promise<AdminPromptsResponse> {
    const growth = await this.settings.get("growth");
    const catalog = resolvePromptCatalog(growth.prompts.catalog);
    const counts = await this.repo.counts(new Date(now.getTime() - COUNT_DAYS * DAY_MS));
    const items: AdminPromptView[] = GROWTH_PROMPT_KINDS.map((key) => ({
      key,
      entry: catalog[key],
      stored: growth.prompts.catalog[key] !== undefined,
      modalAllowed: modalAllowed(key),
      counts: counts.get(key) ?? { shown: 0, clicked: 0, dismissed: 0 },
    }));
    return {
      enabled: growth.prompts.enabled,
      killSwitch: growth.killSwitch,
      items,
      plans: await this.copy.offeredPlans(now),
      placeholders: [...PROMPT_PLACEHOLDERS],
      bannedClaims: growth.bannedClaims,
    };
  }

  /** Saves one entry. Refusals: a modal on a moment that is not calm, a banned claim. */
  async put(
    actorId: string,
    request: FastifyRequest,
    key: GrowthPromptKind,
    entry: PromptEntry,
  ): Promise<AdminPromptView> {
    if (entry.form === "modal" && !modalAllowed(key)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, {
        details: { reason: "modal_not_allowed", key },
      });
    }
    const growth = await this.settings.get("growth");
    const next = {
      ...growth,
      prompts: { ...growth.prompts, catalog: { ...growth.prompts.catalog, [key]: entry } },
    };
    await this.copy.assertCleanCopy(next);
    await this.settings.set("growth", next, { actorId, request });
    const view = (await this.list()).items.find((item) => item.key === key);
    if (!view) throw new AppError(ErrorCode.NOT_FOUND);
    return view;
  }

  /** The entry as people would read it now: real plan, price and analyses, sample numbers. */
  async preview(
    key: GrowthPromptKind,
    entry: PromptEntry,
    now = new Date(),
  ): Promise<AdminPromptPreview> {
    const plan = await this.copy.planFacts(entry.targetPlan, now);
    // The organization moment's `{analyses}` is the team's count; every other moment's is the plan's.
    const params = key === "org_usage" ? { ...SAMPLE_PARAMS, analyses: 42 } : SAMPLE_PARAMS;
    const content = this.copy.render({
      entry,
      plan,
      renewAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
      params,
      localized: {
        featureLine: {
          ar: t("growth.prompt.locked_feature.deep.a", undefined, "ar"),
          en: t("growth.prompt.locked_feature.deep.a", undefined, "en"),
        },
      },
    });
    return {
      plan: plan
        ? {
            key: plan.key,
            name: plan.name,
            priceMinor: plan.priceMinor,
            currency: plan.currency,
            analyses: plan.analyses,
            deepMode: plan.deepMode,
          }
        : null,
      content,
    };
  }
}
