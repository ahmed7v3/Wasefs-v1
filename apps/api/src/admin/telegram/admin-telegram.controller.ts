import { Body, Controller, Delete, Get, HttpCode, Post, Put, Req } from "@nestjs/common";
import {
  setTelegramTokenSchema,
  telegramBroadcastTestSchema,
  telegramSettingsInputSchema,
} from "@wasfa/shared/schemas/admin-telegram";

import { AuditCtx, Audited, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminTelegramService } from "./admin-telegram.service.js";

import type { FastifyRequest } from "fastify";

class TokenDto extends createZodDto(setTelegramTokenSchema) {}
class SettingsDto extends createZodDto(telegramSettingsInputSchema) {}
class BroadcastDto extends createZodDto(telegramBroadcastTestSchema) {}

/**
 * The control panel of the Telegram bot (docs/TELEGRAM-BOT.md). Reading is `wa_agent.read`, changing
 * anything is `wa_agent.write` with a fresh login. The token is write-only: answers carry its masked
 * hint and the public username of the bot. Setting changes are audited by `SettingsService.set` itself.
 */
@Controller("admin/telegram")
export class AdminTelegramController {
  constructor(private readonly telegram: AdminTelegramService) {}

  @Get("status")
  @RequirePermission("wa_agent.read")
  @RateLimit(60)
  status() {
    return this.telegram.status();
  }

  @Put("token")
  @RequirePermission("wa_agent.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({ action: "telegram.token_set", targetType: "integration_secret" })
  setToken(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: TokenDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.telegram.setToken(actor.id, body.token, audit);
  }

  @Delete("token")
  @HttpCode(204)
  @RequirePermission("wa_agent.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({ action: "telegram.token_clear", targetType: "integration_secret" })
  async clearToken(@AuditCtx() audit: AuditScope): Promise<void> {
    await this.telegram.clearToken(audit);
  }

  @Get("settings")
  @RequirePermission("wa_agent.read")
  @RateLimit(60)
  settings() {
    return this.telegram.getSettings();
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
    return this.telegram.putSettings(actor.id, request, body);
  }

  @Post("broadcast-test")
  @HttpCode(200)
  @RequirePermission("wa_agent.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({ action: "telegram.broadcast_test", targetType: "integration_secret" })
  broadcastTest(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: BroadcastDto,
    @AuditCtx() audit: AuditScope,
  ) {
    audit.targetId = "telegram";
    // The length only: the test text is not worth keeping in the audit log.
    audit.after = { chars: body.text.length };
    return this.telegram.broadcastTest(actor.id, body.text);
  }
}
