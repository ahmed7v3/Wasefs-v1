import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { playgroundRequestSchema } from "@wasfa/shared/schemas/admin-ai";

import { Audited, AuditCtx, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminAiPlaygroundService, PLAYGROUND_AUDIT_FIELDS } from "./admin-ai-playground.service.js";

class PlaygroundDto extends createZodDto(playgroundRequestSchema) {}

@Controller("admin/ai/playground")
export class AdminAiPlaygroundController {
  constructor(private readonly playground: AdminAiPlaygroundService) {}

  // Every run is real provider spend: `ai.write`, a per-IP limit here and 20 runs per hour per admin in the service.
  @Post()
  @HttpCode(200)
  @RequirePermission("ai.write")
  @RateLimit(30)
  @Audited({
    action: "ai.playground.run",
    targetType: "ai_playground",
    fields: PLAYGROUND_AUDIT_FIELDS,
  })
  run(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: PlaygroundDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.playground.run(actor.id, body, audit);
  }
}
