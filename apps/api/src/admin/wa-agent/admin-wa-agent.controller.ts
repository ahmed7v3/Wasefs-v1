import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { cursorQuerySchema } from "@wasfa/shared/schemas/admin";
import {
  pauseConversationSchema,
  setVoiceKeySchema,
  waAgentConversationListQuerySchema,
  waAgentIdParamSchema,
  waAgentUsageQuerySchema,
} from "@wasfa/shared/schemas/admin-wa-agent";
import { waAgentSettingsSchema } from "@wasfa/shared/settings";

import { AuditCtx, Audited, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminWaAgentService } from "./admin-wa-agent.service.js";

import type { FastifyRequest } from "fastify";

class IdParamDto extends createZodDto(waAgentIdParamSchema) {}
class SettingsDto extends createZodDto(waAgentSettingsSchema) {}
class VoiceKeyDto extends createZodDto(setVoiceKeySchema) {}
class ConversationListQueryDto extends createZodDto(waAgentConversationListQuerySchema) {}
class MessagesQueryDto extends createZodDto(cursorQuerySchema.pick({ cursor: true })) {}
class PauseDto extends createZodDto(pauseConversationSchema) {}
class UsageQueryDto extends createZodDto(waAgentUsageQuerySchema) {}

/**
 * The control panel of the WhatsApp AI agent (docs/WA-AGENT.md work package E). Settings and usage
 * are `wa_agent.read`; changing anything is `wa_agent.write` with a fresh login; transcripts and
 * their media are health data behind their own `wa_agent.inbox` permission, and every read is audited.
 * Setting changes are audited by `SettingsService.set` itself.
 */
@Controller("admin/wa-agent")
export class AdminWaAgentController {
  constructor(private readonly agent: AdminWaAgentService) {}

  @Get("settings")
  @RequirePermission("wa_agent.read")
  @RateLimit(60)
  settings() {
    return this.agent.getSettings();
  }

  @Put("settings")
  @RequirePermission("wa_agent.write")
  @RequireFreshAuth(10)
  @RateLimit(20)
  putSettings(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Body() body: SettingsDto,
  ) {
    return this.agent.putSettings(actor.id, request, body);
  }

  @Put("voice-key")
  @RequirePermission("wa_agent.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({ action: "wa_agent.voice_key_set", targetType: "integration_secret" })
  setVoiceKey(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: VoiceKeyDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.agent.setVoiceKey(actor.id, body.apiKey, audit);
  }

  @Delete("voice-key")
  @HttpCode(204)
  @RequirePermission("wa_agent.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({ action: "wa_agent.voice_key_clear", targetType: "integration_secret" })
  async clearVoiceKey(@AuditCtx() audit: AuditScope): Promise<void> {
    await this.agent.clearVoiceKey(audit);
  }

  @Get("conversations")
  @RequirePermission("wa_agent.inbox")
  @RateLimit(120)
  conversations(@Query() query: ConversationListQueryDto) {
    return this.agent.conversations(query);
  }

  @Get("conversations/:id/messages")
  @RequirePermission("wa_agent.inbox")
  @RateLimit(120)
  messages(
    @Req() request: FastifyRequest,
    @Param() params: IdParamDto,
    @Query() query: MessagesQueryDto,
  ) {
    return this.agent.messages(request, params.id, query);
  }

  @Get("messages/:id/media-url")
  @RequirePermission("wa_agent.inbox")
  @RateLimit(60)
  mediaUrl(@Req() request: FastifyRequest, @Param() params: IdParamDto) {
    return this.agent.mediaUrl(request, params.id);
  }

  @Post("conversations/:id/pause")
  @HttpCode(200)
  @RequirePermission("wa_agent.write")
  @RequireFreshAuth(10)
  @RateLimit(60)
  @Audited({ action: "wa_agent.conversation_pause", targetType: "wa_conversation" })
  pause(@Param() params: IdParamDto, @Body() body: PauseDto, @AuditCtx() audit: AuditScope) {
    return this.agent.pause(params.id, body.minutes, audit);
  }

  @Post("conversations/:id/resume")
  @HttpCode(200)
  @RequirePermission("wa_agent.write")
  @RequireFreshAuth(10)
  @RateLimit(60)
  @Audited({ action: "wa_agent.conversation_resume", targetType: "wa_conversation" })
  resume(@Param() params: IdParamDto, @AuditCtx() audit: AuditScope) {
    return this.agent.resume(params.id, audit);
  }

  @Post("conversations/:id/block")
  @HttpCode(200)
  @RequirePermission("wa_agent.write")
  @RequireFreshAuth(10)
  @RateLimit(60)
  @Audited({ action: "wa_agent.conversation_block", targetType: "wa_conversation" })
  block(@Param() params: IdParamDto, @AuditCtx() audit: AuditScope) {
    return this.agent.block(params.id, audit);
  }

  @Post("conversations/:id/unblock")
  @HttpCode(200)
  @RequirePermission("wa_agent.write")
  @RequireFreshAuth(10)
  @RateLimit(60)
  @Audited({ action: "wa_agent.conversation_unblock", targetType: "wa_conversation" })
  unblock(@Param() params: IdParamDto, @AuditCtx() audit: AuditScope) {
    return this.agent.unblock(params.id, audit);
  }

  @Get("usage")
  @RequirePermission("wa_agent.read")
  @RateLimit(60)
  usage(@Query() query: UsageQueryDto) {
    return this.agent.usage(query.days);
  }
}
