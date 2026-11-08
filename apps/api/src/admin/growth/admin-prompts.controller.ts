import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from "@nestjs/common";
import { adminPromptKeyParamSchema, adminPromptWriteSchema } from "@wasfa/shared/schemas/growth";

import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminPromptsService } from "./admin-prompts.service.js";

import type { FastifyRequest } from "fastify";

class KeyDto extends createZodDto(adminPromptKeyParamSchema) {}
class EntryDto extends createZodDto(adminPromptWriteSchema) {}

/** The conversion prompts console API (home-ads-conversion, D7): list, edit, preview. */
@Controller("admin/growth/prompts")
export class AdminPromptsController {
  constructor(private readonly prompts: AdminPromptsService) {}

  @Get()
  @RequirePermission("referrals.read")
  @RateLimit(120)
  list() {
    return this.prompts.list();
  }

  // `SettingsService.set` writes the `setting.update` audit row (before/after of the whole `growth`
  // value), so there is no `@Audited` here, exactly like `PUT /admin/settings/:key`.
  @Put(":key")
  @RequirePermission("promotions.write")
  @RateLimit(30)
  put(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: KeyDto,
    @Body() body: EntryDto,
  ) {
    return this.prompts.put(actor.id, request, params.key, body);
  }

  @Post(":key/preview")
  @HttpCode(200)
  @RequirePermission("referrals.read")
  @RateLimit(60)
  preview(@Param() params: KeyDto, @Body() body: EntryDto) {
    return this.prompts.preview(params.key, body);
  }
}
