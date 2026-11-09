import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  publishingKeyInputSchema,
  rotatePublishingKeySchema,
} from "@wasfa/shared/schemas/admin-publishing-keys";
import { z } from "zod";

import { AuditCtx, Audited, type AuditScope } from "../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RequireFreshAuth } from "../common/fresh-auth.js";
import { RequirePermission } from "../common/permissions.guard.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";

import {
  AdminPublishingKeysService,
  PUBLISHING_KEY_AUDIT_FIELDS,
} from "./admin-publishing-keys.service.js";
import { publishingKeyPatchSchema } from "./publishing-key-patch.js";

const keyParamSchema = z.object({ id: z.string().uuid() });
const requestsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

class KeyParamDto extends createZodDto(keyParamSchema) {}
class CreateKeyDto extends createZodDto(publishingKeyInputSchema) {}
class PatchKeyDto extends createZodDto(publishingKeyPatchSchema) {}
class RotateKeyDto extends createZodDto(rotatePublishingKeySchema) {}
class RequestsQueryDto extends createZodDto(requestsQuerySchema) {}

const audited = (action: string) =>
  Audited({
    action: `publishing_key.${action}`,
    targetType: "publishing_key",
    fields: PUBLISHING_KEY_AUDIT_FIELDS,
  });

/** `admin/content/api-keys`: Publishing API keys (docs/PUBLISHING-API.md section 3). The secret is only in create and rotate responses. */
@Controller("admin/content/api-keys")
export class AdminPublishingKeysController {
  constructor(private readonly keys: AdminPublishingKeysService) {}

  @Get()
  @RequirePermission("content.api_keys")
  @RateLimit(120)
  list() {
    return this.keys.list();
  }

  @Post()
  @RequirePermission("content.api_keys")
  @RequireFreshAuth(10)
  @RateLimit(20)
  @audited("created")
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateKeyDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.keys.create(actor, body, audit);
  }

  @Patch(":id")
  @RequirePermission("content.api_keys")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @audited("updated")
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: KeyParamDto,
    @Body() body: PatchKeyDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.keys.update(actor, params.id, body, audit);
  }

  @Post(":id/revoke")
  @HttpCode(200)
  @RequirePermission("content.api_keys")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @audited("revoked")
  revoke(@Param() params: KeyParamDto, @AuditCtx() audit: AuditScope) {
    return this.keys.revoke(params.id, audit);
  }

  @Post(":id/rotate")
  @HttpCode(200)
  @RequirePermission("content.api_keys")
  @RequireFreshAuth(10)
  @RateLimit(20)
  @audited("rotated")
  rotate(@Param() params: KeyParamDto, @Body() body: RotateKeyDto, @AuditCtx() audit: AuditScope) {
    return this.keys.rotate(params.id, body.graceHours, audit);
  }

  @Get(":id/requests")
  @RequirePermission("content.api_keys")
  @RateLimit(120)
  requests(@Param() params: KeyParamDto, @Query() query: RequestsQueryDto) {
    return this.keys.requests(params.id, query.limit);
  }
}
