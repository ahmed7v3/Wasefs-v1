import { Module, type DynamicModule, type ModuleMetadata } from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";

import { AdminModule } from "./admin/admin.module.js";
import { AlertsModule } from "./alerts/alerts.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { BillingModule } from "./billing/billing.module.js";
import { BrandingModule } from "./branding/branding.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { ChatModule } from "./chat/chat.module.js";
import { AccessModule } from "./common/access.module.js";
import { DatabaseModule } from "./common/database.js";
import { AllExceptionsFilter, ErrorReporter } from "./common/errors.js";
import { InvalidationModule } from "./common/invalidation-bus.js";
import { AppLoggerModule } from "./common/logger.js";
import { OutboxQueueModule } from "./common/outbox-queue.js";
import { RedisModule } from "./common/redis.js";
import { ZodValidationPipe } from "./common/validation.js";
import { ConfigModule } from "./config/config.module.js";
import { ContactModule } from "./contact/contact.module.js";
import { ContentModule } from "./content/content.module.js";
import { PublicContentModule } from "./content/public/public-content.module.js";
import { TaxonomyModule } from "./content/taxonomy/taxonomy.module.js";
import { CouponsModule } from "./coupons/coupons.module.js";
import { CreditsModule } from "./credits/credits.module.js";
import { FilesModule } from "./files/files.module.js";
import { FlagsModule } from "./flags/flags.module.js";
import { GrowthModule } from "./growth/growth.module.js";
import { HealthModule } from "./health/health.module.js";
import { MediaModule } from "./media/media.module.js";
import { MedicationsModule } from "./medications/medications.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { OnboardingModule } from "./onboarding/onboarding.module.js";
import { OrgBillingModule } from "./orgs/org-billing.module.js";
import { OrgsModule } from "./orgs/orgs.module.js";
import { PaymentsModule } from "./payments/payments.module.js";
import { PhoneModule } from "./phone/phone.module.js";
import { RbacModule } from "./rbac/rbac.module.js";
import { ReferralsModule } from "./referrals/referrals.module.js";
import { RewardsModule } from "./rewards/rewards.module.js";
import { RxModule } from "./rx/rx.module.js";
import { SettingsModule } from "./settings/settings.module.js";
import { SiteHealthModule } from "./site-health/site-health.module.js";
import { SubscriptionsModule } from "./subscriptions/subscriptions.module.js";
import { UsersModule } from "./users/users.module.js";
import { WaAgentModule } from "./wa-agent/wa-agent.module.js";
import { WaitlistModule } from "./waitlist/waitlist.module.js";
import { WithdrawalsModule } from "./withdrawals/withdrawals.module.js";

import type { ApiEnv } from "./config/env.js";

@Module({})
export class AppModule {
  /**
   * `extraImports` lets integration tests mount throwaway controllers without shipping them.
   * `authMailer: false` leaves `AUTH_MAILER` to the test (it captures mail instead of queueing it).
   */
  static register(
    env: ApiEnv,
    extraImports: ModuleMetadata["imports"] = [],
    options: { authMailer?: boolean } = {},
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        AppLoggerModule,
        DatabaseModule,
        OutboxQueueModule,
        RedisModule,
        InvalidationModule,
        NotificationsModule.register({ authMailer: options.authMailer ?? true }),
        RbacModule,
        AuditModule,
        SettingsModule,
        FlagsModule,
        AuthModule,
        AccessModule,
        PhoneModule,
        WaAgentModule,
        ContactModule,
        SiteHealthModule,
        WaitlistModule,
        BrandingModule,
        MediaModule,
        ContentModule,
        PublicContentModule,
        TaxonomyModule,
        OnboardingModule,
        UsersModule,
        CreditsModule,
        BillingModule,
        CouponsModule,
        CatalogModule,
        PaymentsModule,
        FilesModule,
        ChatModule,
        RxModule,
        MedicationsModule,
        AdminModule,
        AlertsModule,
        SubscriptionsModule,
        OrgsModule,
        OrgBillingModule,
        ReferralsModule,
        RewardsModule,
        GrowthModule,
        WithdrawalsModule,
        HealthModule,
        ...extraImports,
      ],
      providers: [
        ErrorReporter,
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
      ],
      exports: [ErrorReporter],
    };
  }
}
