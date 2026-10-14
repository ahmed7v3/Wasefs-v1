import { Injectable } from "@nestjs/common";
import { SKILL_REGISTRY } from "@wasfa/ai";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { isChatSkill } from "@wasfa/shared/schemas/chat";

import { SettingsService } from "../../settings/settings.service.js";

import { AdminAiSkillsRepo } from "./admin-ai-skills.repo.js";

import type { AuthenticatedUser } from "../../common/current-user.js";
import type { PutSkillInput, SkillsResponse } from "@wasfa/shared/schemas/admin-ai";
import type { FastifyRequest } from "fastify";

/**
 * Which plans may use each assistant skill: the `skills` setting over the generated registry. A skill
 * without an entry is on for every plan. The write goes through `SettingsService.set`, which
 * validates, clears the caches on every instance and writes the `setting.update` audit row.
 */
@Injectable()
export class AdminAiSkillsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly repo: AdminAiSkillsRepo,
  ) {}

  async list(): Promise<SkillsResponse> {
    const [rules, plans] = await Promise.all([this.settings.get("skills"), this.repo.plans()]);
    return {
      items: SKILL_REGISTRY.map((skill) => {
        const rule = Object.hasOwn(rules, skill.name) ? rules[skill.name] : undefined;
        return {
          name: skill.name,
          description: skill.description,
          tasks: [...skill.tasks],
          version: `${skill.name}@${skill.hash}`,
          hash: skill.hash,
          enabledFor: rule === undefined || rule === "all" ? ("all" as const) : [...rule],
          chat: isChatSkill(skill.name),
        };
      }),
      plans,
    };
  }

  async put(
    actor: AuthenticatedUser,
    request: FastifyRequest,
    name: string,
    input: PutSkillInput,
  ): Promise<SkillsResponse> {
    const skill = SKILL_REGISTRY.find((entry) => entry.name === name);
    if (!skill) throw new AppError(ErrorCode.NOT_FOUND);
    // Only chat skills are gated: a structured prescription reading does not start from a skill choice.
    if (!isChatSkill(name)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { reason: "not_a_chat_skill" } });
    }

    // "all" is the default, so it is stored as no entry at all.
    const next = Object.fromEntries(
      Object.entries(await this.settings.get("skills")).filter(([key]) => key !== name),
    );
    if (input.enabledFor !== "all") {
      const known = new Set((await this.repo.plans()).map((plan) => plan.key));
      const unknown = input.enabledFor.filter((key) => !known.has(key));
      if (unknown.length > 0) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, {
          details: { reason: "unknown_plan", fields: ["enabledFor"] },
        });
      }
      next[name] = [...new Set(input.enabledFor)].sort();
    }
    await this.settings.set("skills", next, { actorId: actor.id, request });
    return this.list();
  }
}
