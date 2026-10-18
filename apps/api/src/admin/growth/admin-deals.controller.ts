import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  createDealSchema,
  dealIdParamSchema,
  dealListQuerySchema,
  dealTargetInputSchema,
  dealTargetParamSchema,
  simulateDealSchema,
  updateDealSchema,
} from "@wasfa/shared/schemas/deals";

import { AuditCtx, Audited, type AuditScope } from "../../audit/audited.decorator.js";
import { resolveMarket } from "../../catalog/market.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto, parseWithSchema } from "../../common/validation.js";
import { API_ENV } from "../../config/config.module.js";
import { SettingsService } from "../../settings/settings.service.js";

import { AdminDealsService } from "./admin-deals.service.js";

import type { ApiEnv } from "../../config/env.js";
import type { FastifyRequest } from "fastify";

class CreateDto extends createZodDto(createDealSchema) {}
class UpdateDto extends createZodDto(updateDealSchema) {}
class IdDto extends createZodDto(dealIdParamSchema) {}
class TargetParamDto extends createZodDto(dealTargetParamSchema) {}
class ListDto extends createZodDto(dealListQuerySchema) {}
class SimulateDto extends createZodDto(simulateDealSchema) {}

/** Deals (Task 3.10; REFERRALS-REWARDS §7): reads need `referrals.read`, every write `deals.write`. */
@Controller("admin/growth/deals")
export class AdminDealsController {
  constructor(
    private readonly deals: AdminDealsService,
    private readonly settings: SettingsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Get()
  @RequirePermission("referrals.read")
  @RateLimit(120)
  list(@Query() query: ListDto) {
    return this.deals.list(query);
  }

  @Post("simulate")
  @HttpCode(200)
  @RequirePermission("referrals.read")
  @RateLimit(30)
  async simulate(@Body() body: SimulateDto, @Req() request: FastifyRequest) {
    const market = resolveMarket(
      {},
      request.headers,
      await this.settings.get("currency"),
      this.env.NODE_ENV === "production",
    );
    return this.deals.simulate(body, market);
  }

  @Get(":id")
  @RequirePermission("referrals.read")
  @RateLimit(120)
  get(@Param() params: IdDto) {
    return this.deals.get(params.id);
  }

  @Post()
  @RequirePermission("deals.write")
  @RateLimit(30)
  @Audited({ action: "deal.created", targetType: "deal" })
  create(
    @Body() body: CreateDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.deals.create(body, user, audit);
  }

  @Patch(":id")
  @RequirePermission("deals.write")
  @RateLimit(30)
  @Audited({ action: "deal.updated", targetType: "deal", targetParam: "id" })
  update(@Param() params: IdDto, @Body() body: UpdateDto, @AuditCtx() audit: AuditScope) {
    return this.deals.update(params.id, body, audit);
  }

  @Post(":id/activate")
  @HttpCode(200)
  @RequirePermission("deals.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "deal.activated", targetType: "deal", targetParam: "id" })
  activate(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    return this.deals.transition(params.id, "activate", audit);
  }

  @Post(":id/pause")
  @HttpCode(200)
  @RequirePermission("deals.write")
  @RateLimit(30)
  @Audited({ action: "deal.paused", targetType: "deal", targetParam: "id" })
  pause(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    return this.deals.transition(params.id, "pause", audit);
  }

  @Post(":id/end")
  @HttpCode(200)
  @RequirePermission("deals.write")
  @RateLimit(30)
  @Audited({ action: "deal.ended", targetType: "deal", targetParam: "id" })
  end(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    return this.deals.transition(params.id, "end", audit);
  }

  @Post(":id/targets")
  @RequirePermission("deals.write")
  @RateLimit(30)
  @Audited({ action: "deal.target_added", targetType: "deal", targetParam: "id" })
  addTarget(@Param() params: IdDto, @Body() body: unknown, @AuditCtx() audit: AuditScope) {
    return this.deals.addTarget(params.id, parseWithSchema(dealTargetInputSchema, body), audit);
  }

  @Delete(":id/targets/:targetId")
  @HttpCode(204)
  @RequirePermission("deals.write")
  @RateLimit(30)
  @Audited({ action: "deal.target_removed", targetType: "deal", targetParam: "id" })
  removeTarget(@Param() params: TargetParamDto, @AuditCtx() audit: AuditScope) {
    return this.deals.removeTarget(params.id, params.targetId, audit);
  }
}
