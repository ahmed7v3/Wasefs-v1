import { Body, Controller, Get, Param, Put, Req } from "@nestjs/common";
import { putSettingSchema } from "@wasfa/shared/schemas/admin";
import { settingKeyParamSchema } from "@wasfa/shared/settings";

import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminSettingsService } from "./admin-settings.service.js";

import type { FastifyRequest } from "fastify";

class SettingKeyParamDto extends createZodDto(settingKeyParamSchema) {}
class PutSettingDto extends createZodDto(putSettingSchema) {}

@Controller("admin/settings")
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get()
  @RequirePermission("settings.read")
  @RateLimit(120)
  list() {
    return this.settings.list();
  }

  // `SettingsService.set` writes the `setting.update` audit row itself, so there is no `@Audited` here.
  @Put(":key")
  @RequirePermission("settings.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  put(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: SettingKeyParamDto,
    @Body() body: PutSettingDto,
  ) {
    return this.settings.put(actor.id, request, params.key, body.value);
  }
}
