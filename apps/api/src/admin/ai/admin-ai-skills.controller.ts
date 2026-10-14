import { Body, Controller, Get, Param, Put, Req } from "@nestjs/common";
import { putSkillSchema, skillParamSchema } from "@wasfa/shared/schemas/admin-ai";

import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminAiSkillsService } from "./admin-ai-skills.service.js";

import type { FastifyRequest } from "fastify";

class SkillParamDto extends createZodDto(skillParamSchema) {}
class PutSkillDto extends createZodDto(putSkillSchema) {}

@Controller("admin/ai/skills")
export class AdminAiSkillsController {
  constructor(private readonly skills: AdminAiSkillsService) {}

  @Get()
  @RequirePermission("ai.read")
  @RateLimit(120)
  list() {
    return this.skills.list();
  }

  // `SettingsService.set` writes the `setting.update` audit row itself, so there is no `@Audited` here.
  @Put(":name")
  @RequirePermission("ai.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  put(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: SkillParamDto,
    @Body() body: PutSkillDto,
  ) {
    return this.skills.put(actor, request, params.name, body);
  }
}
