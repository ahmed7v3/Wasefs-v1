import { Body, Controller, Get, Put, Req } from "@nestjs/common";
import { putAiSettingsSchema } from "@wasfa/shared/schemas/admin-ai";

import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminAiSettingsService } from "./admin-ai-settings.service.js";

import type { FastifyRequest } from "fastify";

class PutAiSettingsDto extends createZodDto(putAiSettingsSchema) {}

@Controller("admin/ai/settings")
export class AdminAiSettingsController {
  constructor(private readonly settings: AdminAiSettingsService) {}

  @Get()
  @RequirePermission("ai.read")
  @RateLimit(120)
  get() {
    return this.settings.get();
  }

  // `SettingsService.set` writes the `setting.update` audit row itself, so there is no `@Audited` here.
  @Put()
  @RequirePermission("ai.write")
  @RequireFreshAuth(10)
  @RateLimit(20)
  put(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Body() body: PutAiSettingsDto,
  ) {
    return this.settings.put(actor, request, body);
  }
}
