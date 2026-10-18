import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createProgramSchema,
  createRuleSchema,
  createTierSchema,
  deleteTierQuerySchema,
  growthIdParamSchema,
  moveMemberSchema,
  reasonBodySchema,
  updateProgramSchema,
  updateRuleSchema,
  updateTierSchema,
  whatIfSchema,
} from "@wasfa/shared/schemas/admin-growth";

import { AuditCtx, Audited, type AuditScope } from "../../audit/audited.decorator.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminRewardConfigService } from "./admin-reward-config.service.js";

class IdDto extends createZodDto(growthIdParamSchema) {}
class CreateProgramDto extends createZodDto(createProgramSchema) {}
class UpdateProgramDto extends createZodDto(updateProgramSchema) {}
class MoveMemberDto extends createZodDto(moveMemberSchema) {}
class CreateRuleDto extends createZodDto(createRuleSchema) {}
class UpdateRuleDto extends createZodDto(updateRuleSchema) {}
class ReasonDto extends createZodDto(reasonBodySchema) {}
class WhatIfDto extends createZodDto(whatIfSchema) {}
class CreateTierDto extends createZodDto(createTierSchema) {}
class UpdateTierDto extends createZodDto(updateTierSchema) {}
class DeleteTierQueryDto extends createZodDto(deleteTierQuerySchema) {}

/**
 * Programs, rules, tiers and the settings preview (Task 3.13; ADMIN-CONSOLE-SPEC §6.1). Reads need
 * `referrals.read`, writes `referrals.write` plus a recent sign-in, and every write names its reason.
 */
@Controller("admin/growth")
export class AdminRewardConfigController {
  constructor(private readonly config: AdminRewardConfigService) {}

  // --- Programs ---------------------------------------------------------------------------------

  @Get("programs")
  @RequirePermission("referrals.read")
  @RateLimit(120)
  programs() {
    return this.config.programs();
  }

  @Post("programs")
  @RequirePermission("referrals.write")
  @RateLimit(30)
  @Audited({ action: "referral_program.created", targetType: "referral_program" })
  createProgram(@Body() body: CreateProgramDto, @AuditCtx() audit: AuditScope) {
    return this.config.createProgram(body, audit);
  }

  @Patch("programs/:id")
  @RequirePermission("referrals.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "referral_program.updated", targetType: "referral_program" })
  updateProgram(
    @Param() params: IdDto,
    @Body() body: UpdateProgramDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.config.updateProgram(params.id, body, audit);
  }

  @Post("programs/:id/members")
  @HttpCode(200)
  @RequirePermission("referrals.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "referral_program.member_moved", targetType: "referral_program" })
  moveMember(@Param() params: IdDto, @Body() body: MoveMemberDto, @AuditCtx() audit: AuditScope) {
    return this.config.moveMember(params.id, body.userId, body.reason, audit);
  }

  // --- Rules ------------------------------------------------------------------------------------

  @Get("programs/:id/rules")
  @RequirePermission("referrals.read")
  @RateLimit(120)
  rules(@Param() params: IdDto) {
    return this.config.rules(params.id);
  }

  @Post("programs/:id/rules")
  @RequirePermission("referrals.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "reward_rule.created", targetType: "reward_rule" })
  createRule(@Param() params: IdDto, @Body() body: CreateRuleDto, @AuditCtx() audit: AuditScope) {
    return this.config.createRule(params.id, body, audit);
  }

  /** Declared before `rules/:id/...` so `what-if` is never read as an id. */
  @Post("rules/what-if")
  @HttpCode(200)
  @RequirePermission("referrals.read")
  @RateLimit(60)
  whatIf(@Body() body: WhatIfDto) {
    return this.config.whatIf(body);
  }

  @Patch("rules/:id")
  @RequirePermission("referrals.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "reward_rule.updated", targetType: "reward_rule" })
  updateRule(@Param() params: IdDto, @Body() body: UpdateRuleDto, @AuditCtx() audit: AuditScope) {
    return this.config.updateRule(params.id, body, audit);
  }

  @Post("rules/:id/deactivate")
  @HttpCode(200)
  @RequirePermission("referrals.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "reward_rule.deactivated", targetType: "reward_rule" })
  deactivateRule(@Param() params: IdDto, @Body() body: ReasonDto, @AuditCtx() audit: AuditScope) {
    return this.config.deactivateRule(params.id, body, audit);
  }

  // --- Tiers ------------------------------------------------------------------------------------

  @Get("programs/:id/tiers")
  @RequirePermission("referrals.read")
  @RateLimit(120)
  tiers(@Param() params: IdDto) {
    return this.config.tiers(params.id);
  }

  @Post("programs/:id/tiers")
  @RequirePermission("referrals.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "referral_tier.created", targetType: "referral_tier" })
  createTier(@Param() params: IdDto, @Body() body: CreateTierDto, @AuditCtx() audit: AuditScope) {
    return this.config.createTier(params.id, body, audit);
  }

  @Patch("tiers/:id")
  @RequirePermission("referrals.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "referral_tier.updated", targetType: "referral_tier" })
  updateTier(@Param() params: IdDto, @Body() body: UpdateTierDto, @AuditCtx() audit: AuditScope) {
    return this.config.updateTier(params.id, body, audit);
  }

  @Delete("tiers/:id")
  @HttpCode(204)
  @RequirePermission("referrals.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "referral_tier.deleted", targetType: "referral_tier" })
  deleteTier(
    @Param() params: IdDto,
    @Query() query: DeleteTierQueryDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.config.deleteTier(params.id, query.reason, audit);
  }

  // --- Settings ---------------------------------------------------------------------------------

  /** The `rewards` setting itself is edited through `PUT /admin/settings/rewards`; this adds the money view. */
  @Get("settings/rewards/preview")
  @RequirePermission("referrals.read")
  @RateLimit(60)
  settingsPreview() {
    return this.config.settingsPreview();
  }
}
