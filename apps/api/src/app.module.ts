import { Module, type DynamicModule, type ModuleMetadata } from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";

import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { AccessModule } from "./common/access.module.js";
import { DatabaseModule } from "./common/database.js";
import { AllExceptionsFilter, ErrorReporter } from "./common/errors.js";
import { AppLoggerModule } from "./common/logger.js";
import { RedisModule } from "./common/redis.js";
import { ZodValidationPipe } from "./common/validation.js";
import { ConfigModule } from "./config/config.module.js";
import { HealthModule } from "./health/health.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { OnboardingModule } from "./onboarding/onboarding.module.js";
import { OrgsModule } from "./orgs/orgs.module.js";
import { PhoneModule } from "./phone/phone.module.js";
import { RbacModule } from "./rbac/rbac.module.js";
import { UsersModule } from "./users/users.module.js";

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
        RedisModule,
        NotificationsModule.register({ authMailer: options.authMailer ?? true }),
        RbacModule,
        AuditModule,
        AuthModule,
        AccessModule,
        PhoneModule,
        OnboardingModule,
        UsersModule,
        OrgsModule,
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
