import { Module } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { DB, type DbHandle } from "../common/database.js";
import { API_ENV } from "../config/config.module.js";
import { SettingsService } from "../settings/settings.service.js";

import { createAuth } from "./auth.config.js";
import { AuthController } from "./auth.controller.js";
import { AuthPolicy } from "./auth.policy.js";
import { AuthRepo } from "./auth.repo.js";
import { AUTH, AuthService } from "./auth.service.js";
import { AUTH_MAILER, UnconfiguredMailer, type AuthMailer } from "./mailer.js";
import { PASSWORD_HASHER, createPasswordHasher, type PasswordHasher } from "./password.js";
import { AuthRateLimiter } from "./rate-limiter.js";
import { TurnstileService } from "./turnstile.js";

import type { ApiEnv } from "../config/env.js";

/**
 * Authentication. `AUTH_MAILER` is optional: the worker-backed mailer of Task 1.4 (or a test double)
 * is provided by another module; without one, mail is logged as not sent.
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthRateLimiter,
    TurnstileService,
    AuthPolicy,
    AuthRepo,
    AuthService,
    {
      provide: PASSWORD_HASHER,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => createPasswordHasher(env.ARGON2_MEMORY_KIB),
    },
    {
      provide: AUTH,
      inject: [
        API_ENV,
        DB,
        SettingsService,
        PinoLogger,
        PASSWORD_HASHER,
        { token: AUTH_MAILER, optional: true },
      ],
      useFactory: (
        env: ApiEnv,
        handle: DbHandle,
        settings: SettingsService,
        logger: PinoLogger,
        passwords: PasswordHasher,
        mailer: AuthMailer | null,
      ) => {
        logger.setContext("Auth");
        return createAuth({
          env,
          db: handle.db,
          settings,
          mailer: mailer ?? new UnconfiguredMailer(logger),
          passwords,
          log: (level, message) => logger[level](message),
        });
      },
    },
  ],
  exports: [AUTH, AuthService, AuthRateLimiter, TurnstileService],
})
export class AuthModule {}
