import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { hasPermission, type AuthenticatedUser } from "../../common/current-user.js";
import { SettingsService } from "../../settings/settings.service.js";

import { AdminAiSettingsRepo } from "./admin-ai-settings.repo.js";

import type { AiSettingsResponse, PutAiSettingsInput } from "@wasfa/shared/schemas/admin-ai";
import type { FastifyRequest } from "fastify";

/** Spend cap, alert threshold, kill switches and credit value (the `ai` setting). */
@Injectable()
export class AdminAiSettingsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly repo: AdminAiSettingsRepo,
  ) {}

  async get(): Promise<AiSettingsResponse> {
    const [value, updatedAt] = await Promise.all([this.settings.get("ai"), this.repo.updatedAt()]);
    return { value, updatedAt: updatedAt?.toISOString() ?? null };
  }

  /**
   * Stopping or resuming AI work is a stronger right than editing the cap: a change to any kill
   * switch also needs `ai.killswitch`. `SettingsService.set` writes the `setting.update` audit row,
   * so this route is not `@Audited`.
   */
  async put(
    actor: AuthenticatedUser,
    request: FastifyRequest,
    input: PutAiSettingsInput,
  ): Promise<AiSettingsResponse> {
    const current = await this.settings.get("ai");
    const switchChanged = (Object.keys(input.killSwitch) as (keyof typeof input.killSwitch)[]).some(
      (name) => input.killSwitch[name] !== current.killSwitch[name],
    );
    if (switchChanged && !hasPermission(actor, "ai.killswitch")) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "killswitch_permission" } });
    }
    await this.settings.set("ai", input, { actorId: actor.id, request });
    return this.get();
  }
}
