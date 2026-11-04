import { Readable } from "node:stream";

import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from "@nestjs/common";
import {
  adminEarlyFilterSchema,
  adminEarlyLinkCreateSchema,
  adminEarlySignupPatchSchema,
  adminEarlySignupsQuerySchema,
} from "@wasfa/shared/schemas/early-access";
import { z } from "zod";

import { AuditCtx, Audited, type AuditScope } from "../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RequirePermission } from "../common/permissions.guard.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";

import { AdminEarlyAccessService } from "./admin-early-access.service.js";

class FilterDto extends createZodDto(adminEarlyFilterSchema) {}
class SignupsQueryDto extends createZodDto(adminEarlySignupsQuerySchema) {}
class SignupPatchDto extends createZodDto(adminEarlySignupPatchSchema) {}
class LinkCreateDto extends createZodDto(adminEarlyLinkCreateSchema) {}
class LinkPatchDto extends createZodDto(z.object({ active: z.boolean() })) {}
class IdDto extends createZodDto(z.object({ id: z.uuid() })) {}

function csvFile(lines: string[], filename: string): StreamableFile {
  return new StreamableFile(Readable.from(lines), {
    type: "text/csv; charset=utf-8",
    disposition: `attachment; filename="${filename}"`,
  });
}

/*
 * Early-access dashboard data. The sign-ups are personal data: reads need `users.read`; edits and
 * campaign links need `referrals.write` (the growth permission; there is no `users.write`).
 */
@Controller("admin/early-access")
export class AdminEarlyAccessController {
  constructor(private readonly admin: AdminEarlyAccessService) {}

  @Get("overview")
  @RequirePermission("users.read")
  @RateLimit(60)
  overview(@Query() query: FilterDto) {
    return this.admin.overview(query);
  }

  @Get("signups")
  @RequirePermission("users.read")
  @RateLimit(60)
  signups(@Query() query: SignupsQueryDto) {
    return this.admin.signups(query);
  }

  /** Audited: it is an export of personal data. */
  @Get("signups/export.csv")
  @RequirePermission("users.read")
  @RateLimit(10)
  @Audited({ action: "early_access.signups.export", targetType: "early_access" })
  @Header("Cache-Control", "no-store")
  async signupsCsv(
    @Query() query: SignupsQueryDto,
    @AuditCtx() audit: AuditScope,
  ): Promise<StreamableFile> {
    const lines = await this.admin.signupsCsv(query);
    audit.after = { rows: lines.length - 1 };
    return csvFile(lines, "early-access-signups.csv");
  }

  @Get("events/export.csv")
  @RequirePermission("users.read")
  @RateLimit(10)
  @Audited({ action: "early_access.events.export", targetType: "early_access" })
  @Header("Cache-Control", "no-store")
  async eventsCsv(
    @Query() query: FilterDto,
    @AuditCtx() audit: AuditScope,
  ): Promise<StreamableFile> {
    const lines = await this.admin.eventsCsv(query);
    audit.after = { rows: lines.length - 1 };
    return csvFile(lines, "early-access-events.csv");
  }

  @Patch("signups/:id")
  @RequirePermission("referrals.write")
  @RateLimit(60)
  @Audited({ action: "early_access.signup.update", targetType: "early_access_signup" })
  async patchSignup(
    @Param() params: IdDto,
    @Body() body: SignupPatchDto,
    @AuditCtx() audit: AuditScope,
  ) {
    const result = await this.admin.patchSignup(params.id, body);
    audit.before = result.before;
    audit.after = result.after;
    return result.signup;
  }

  @Get("links")
  @RequirePermission("users.read")
  @RateLimit(60)
  links() {
    return this.admin.links();
  }

  @Post("links")
  @RequirePermission("referrals.write")
  @RateLimit(30)
  @Audited({
    action: "early_access.link.create",
    targetType: "campaign_link",
    afterFromResponse: true,
  })
  createLink(@Body() body: LinkCreateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admin.createLink(body, user.id);
  }

  @Patch("links/:id")
  @RequirePermission("referrals.write")
  @RateLimit(30)
  @Audited({
    action: "early_access.link.update",
    targetType: "campaign_link",
    afterFromResponse: true,
  })
  setLinkActive(@Param() params: IdDto, @Body() body: LinkPatchDto) {
    return this.admin.setLinkActive(params.id, body.active);
  }
}
