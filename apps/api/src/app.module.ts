import { Module, type DynamicModule, type ModuleMetadata } from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";

import { AuthModule } from "./auth/auth.module.js";
import { DatabaseModule } from "./common/database.js";
import { AllExceptionsFilter, ErrorReporter } from "./common/errors.js";
import { AppLoggerModule } from "./common/logger.js";
import { RedisModule } from "./common/redis.js";
import { ZodValidationPipe } from "./common/validation.js";
import { ConfigModule } from "./config/config.module.js";
import { HealthModule } from "./health/health.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";

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
        AuthModule,
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
