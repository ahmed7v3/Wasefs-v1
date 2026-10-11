import { Body, Controller, Get, HttpCode, Post, Put, Req } from "@nestjs/common";
import { linkWhatsappSchema, setPhoneVerificationSchema } from "@wasfa/shared/schemas/admin";

import { AuditCtx, Audited, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminWhatsappService } from "./admin-whatsapp.service.js";

import type { FastifyRequest } from "fastify";

class LinkWhatsappDto extends createZodDto(linkWhatsappSchema) {}
class SetPhoneVerificationDto extends createZodDto(setPhoneVerificationSchema) {}

// The number and the kill switch are settings, so `SettingsService.set` writes their
// `setting.update` audit rows itself; only `unlink` needs `@Audited`.
@Controller("admin/whatsapp")
export class AdminWhatsappController {
  constructor(private readonly whatsapp: AdminWhatsappService) {}

  /** Polled every 2 seconds by the page while a pairing is in progress. */
  @Get()
  @RequirePermission("settings.read")
  @RateLimit(60)
  status() {
    return this.whatsapp.status();
  }

  @Post("link")
  @HttpCode(202)
  @RequirePermission("settings.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  link(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Body() body: LinkWhatsappDto,
  ) {
    return this.whatsapp.link(actor.id, request, body.number);
  }

  @Post("unlink")
  @HttpCode(202)
  @RequirePermission("settings.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({ action: "whatsapp.unlink", targetType: "whatsapp" })
  async unlink(@AuditCtx() audit: AuditScope) {
    const queued = await this.whatsapp.unlink();
    audit.targetId = queued.id;
    return queued;
  }

  @Put("verification")
  @RequirePermission("settings.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  setVerification(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Body() body: SetPhoneVerificationDto,
  ) {
    return this.whatsapp.setVerification(actor.id, request, body.enabled);
  }
}
