import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { cursorQuerySchema } from "@wasfa/shared/schemas/admin";
import { adjustCreditsSchema, adminWalletListQuerySchema } from "@wasfa/shared/schemas/credits";
import { z } from "zod";

import { Audited, AuditCtx, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminCreditsService, CREDITS_AUDIT_FIELDS } from "./admin-credits.service.js";

class WalletListQueryDto extends createZodDto(adminWalletListQuerySchema) {}
class LedgerQueryDto extends createZodDto(cursorQuerySchema) {}
class WalletParamDto extends createZodDto(z.object({ walletId: z.uuid() })) {}
class AdjustCreditsDto extends createZodDto(adjustCreditsSchema) {}

@Controller("admin/credits")
export class AdminCreditsController {
  constructor(private readonly credits: AdminCreditsService) {}

  // Seeing balances is part of seeing usage and cost; adjusting them is a separate, stronger right.
  @Get("wallets")
  @RequirePermission("usage.read")
  @RateLimit(120)
  wallets(@Query() query: WalletListQueryDto) {
    return this.credits.wallets(query);
  }

  @Get("wallets/:walletId/ledger")
  @RequirePermission("usage.read")
  @RateLimit(120)
  ledger(@Param() params: WalletParamDto, @Query() query: LedgerQueryDto) {
    return this.credits.ledger(params.walletId, query);
  }

  @Post("adjust")
  @HttpCode(200)
  @RequirePermission("credits.adjust")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "credits.adjust", targetType: "credit_wallet", fields: CREDITS_AUDIT_FIELDS })
  adjust(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: AdjustCreditsDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.credits.adjust(actor, body, audit);
  }
}
