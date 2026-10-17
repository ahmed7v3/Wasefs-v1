import { Body, Controller, Get, Param, Patch, Post, Put } from "@nestjs/common";
import {
  adminConsoleIdSchema,
  adminConsoleKeySchema,
  adminCreditPackCreateSchema,
  adminCreditPackPatchSchema,
  adminCreditPackPricesSchema,
  adminPaymentMethodPatchSchema,
  adminPlanPricesSchema,
  adminPublishPlanPricesSchema,
  adminTaxRulePatchSchema,
  adminTaxRuleSchema,
} from "@wasfa/shared/schemas/admin-billing-console";

import { AuditCtx, Audited, type AuditScope } from "../../audit/audited.decorator.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminBillingCatalogService } from "./admin-billing-catalog.service.js";

class IdDto extends createZodDto(adminConsoleIdSchema) {}
class KeyDto extends createZodDto(adminConsoleKeySchema) {}
class PlanPricesDto extends createZodDto(adminPlanPricesSchema) {}
class PublishPlanPricesDto extends createZodDto(adminPublishPlanPricesSchema) {}
class CreditPackCreateDto extends createZodDto(adminCreditPackCreateSchema) {}
class CreditPackPatchDto extends createZodDto(adminCreditPackPatchSchema) {}
class CreditPackPricesDto extends createZodDto(adminCreditPackPricesSchema) {}
class MethodPatchDto extends createZodDto(adminPaymentMethodPatchSchema) {}
class TaxRuleCreateDto extends createZodDto(adminTaxRuleSchema) {}
class TaxRulePatchDto extends createZodDto(adminTaxRulePatchSchema) {}

/**
 * The commercial catalog: plan prices, credit packs, payment methods and tax rules. Plan metadata
 * (names, copy, features, trial) stays on `PATCH /admin/plans/:id`.
 */
@Controller("admin/billing")
export class AdminBillingCatalogController {
  constructor(private readonly catalog: AdminBillingCatalogService) {}

  @Get("plans")
  @RequirePermission("billing.read")
  @RateLimit(60)
  plans() {
    return this.catalog.plans();
  }

  @Post("plans/:id/prices/preview")
  @RequirePermission("billing.read")
  @RateLimit(30)
  previewPrices(@Param() params: IdDto, @Body() body: PlanPricesDto) {
    return this.catalog.previewPlanPrices(params.id, body.prices);
  }

  @Put("plans/:id/prices")
  @RequirePermission("billing.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({ action: "plan.prices_published", targetType: "plan", targetParam: "id" })
  publishPrices(
    @Param() params: IdDto,
    @Body() body: PublishPlanPricesDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.catalog.publishPlanPrices(
      params.id,
      body.prices,
      { reason: body.reason, overrideMargin: body.overrideMargin === true },
      audit,
    );
  }

  @Get("credit-packs")
  @RequirePermission("billing.read")
  @RateLimit(60)
  creditPacks() {
    return this.catalog.creditPacks();
  }

  @Post("credit-packs")
  @RequirePermission("billing.write")
  @RateLimit(20)
  @Audited({ action: "credit_pack.created", targetType: "credit_pack" })
  createCreditPack(@Body() body: CreditPackCreateDto, @AuditCtx() audit: AuditScope) {
    return this.catalog.createCreditPack(body, audit);
  }

  @Patch("credit-packs/:id")
  @RequirePermission("billing.write")
  @RateLimit(20)
  @Audited({ action: "credit_pack.updated", targetType: "credit_pack", targetParam: "id" })
  updateCreditPack(
    @Param() params: IdDto,
    @Body() body: CreditPackPatchDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.catalog.updateCreditPack(params.id, body, audit);
  }

  @Put("credit-packs/:id/prices")
  @RequirePermission("billing.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({ action: "credit_pack.prices_updated", targetType: "credit_pack", targetParam: "id" })
  setCreditPackPrices(
    @Param() params: IdDto,
    @Body() body: CreditPackPricesDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.catalog.setCreditPackPrices(params.id, body.prices, body.reason, audit);
  }

  @Get("methods")
  @RequirePermission("billing.read")
  @RateLimit(60)
  methods() {
    return this.catalog.methods();
  }

  @Patch("methods/:key")
  @RequirePermission("billing.write")
  @RequireFreshAuth(10)
  @RateLimit(20)
  @Audited({ action: "payment_method.updated", targetType: "payment_method", targetParam: "key" })
  updateMethod(
    @Param() params: KeyDto,
    @Body() body: MethodPatchDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.catalog.updateMethod(params.key, body, audit);
  }

  @Get("tax-rules")
  @RequirePermission("billing.read")
  @RateLimit(60)
  taxRules() {
    return this.catalog.taxRules();
  }

  @Post("tax-rules")
  @RequirePermission("billing.write")
  @RequireFreshAuth(10)
  @RateLimit(20)
  @Audited({ action: "tax_rule.created", targetType: "tax_rule" })
  createTaxRule(@Body() body: TaxRuleCreateDto, @AuditCtx() audit: AuditScope) {
    return this.catalog.createTaxRule(body, audit);
  }

  @Patch("tax-rules/:id")
  @RequirePermission("billing.write")
  @RequireFreshAuth(10)
  @RateLimit(20)
  @Audited({ action: "tax_rule.updated", targetType: "tax_rule", targetParam: "id" })
  updateTaxRule(
    @Param() params: IdDto,
    @Body() body: TaxRulePatchDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.catalog.updateTaxRule(params.id, body, audit);
  }
}
