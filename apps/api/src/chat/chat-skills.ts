import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { skillEnabledForPlan } from "@wasfa/shared/settings";

import { PlansService } from "../plans/plans.service.js";
import { SettingsService } from "../settings/settings.service.js";

import type { WalletOwner } from "@wasfa/db";

/**
 * The body of a chat skill (`skills/<key>/SKILL.md`), appended to the system prompt right after the
 * fixed persona so the prefix stays cache-friendly. TODO(2.11): switch to the generated skills
 * registry of `@wasfa/ai` once it exists.
 */
export function skillBody(skill: string | null): string | null {
  void skill;
  return null;
}

/**
 * The `skills` setting (admin: `/admin/ai/skills`) says which plans may use which skill. A chat
 * with a skill the owner's plan does not include is refused like any other plan feature, both when
 * it starts and when a message is sent (the plan or the setting may have changed in between).
 */
@Injectable()
export class ChatSkillGate {
  constructor(
    private readonly settings: SettingsService,
    private readonly plans: PlansService,
  ) {}

  async assertAllowed(owner: WalletOwner, skill: string | null): Promise<void> {
    if (skill === null) return;
    const rules = await this.settings.get("skills");
    // Nothing configured for this skill: on for everyone, no plan lookup needed.
    if (!Object.hasOwn(rules, skill)) return;
    const plan = await this.plans.effectivePlan(owner);
    if (!skillEnabledForPlan(rules, skill, plan.key)) {
      throw new AppError(ErrorCode.PAYMENT_REQUIRED, { details: { reason: "plan_feature" } });
    }
  }
}
