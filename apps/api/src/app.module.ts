import { Module, type DynamicModule, type ModuleMetadata } from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";

import { DatabaseModule } from "./common/database.js";
import { AllExceptionsFilter, ErrorReporter } from "./common/errors.js";
import { AppLoggerModule } from "./common/logger.js";
import { RedisModule } from "./common/redis.js";
import { ZodValidationPipe } from "./common/validation.js";
import { ConfigModule } from "./config/config.module.js";
import { HealthModule } from "./health/health.module.js";

import type { ApiEnv } from "./config/env.js";

@Module({})
export class AppModule {
  /** `extraImports` lets integration tests mount throwaway controllers without shipping them. */
  static register(env: ApiEnv, extraImports: ModuleMetadata["imports"] = []): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        AppLoggerModule,
        DatabaseModule,
        RedisModule,
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
