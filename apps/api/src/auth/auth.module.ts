import { Module } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { DB, type DbHandle } from "../common/database.js";
import { REDIS } from "../common/redis.js";
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
import { WaLoginConsumer } from "./whatsapp-login/wa-login.consumer.js";
import { WaLoginStore } from "./whatsapp-login/wa-login.store.js";
import { WhatsAppLoginRepo } from "./whatsapp-login/whatsapp-login.repo.js";
import { WhatsAppLoginService } from "./whatsapp-login/whatsapp-login.service.js";

import type { ApiEnv } from "../config/env.js";
import type { Redis } from "ioredis";

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
    WhatsAppLoginRepo,
    {
      provide: WaLoginStore,
      inject: [REDIS],
      useFactory: (redis: Redis) => new WaLoginStore(redis),
    },
    WhatsAppLoginService,
    WaLoginConsumer,
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
        WhatsAppLoginService,
        { token: AUTH_MAILER, optional: true },
      ],
      useFactory: (
        env: ApiEnv,
        handle: DbHandle,
        settings: SettingsService,
        logger: PinoLogger,
        passwords: PasswordHasher,
        whatsappLogin: WhatsAppLoginService,
        mailer: AuthMailer | null,
      ) => {
        logger.setContext("Auth");
        return createAuth({
          env,
          db: handle.db,
          settings,
          mailer: mailer ?? new UnconfiguredMailer(logger),
          passwords,
          whatsappLogin,
          log: (level, message) => logger[level](message),
        });
      },
    },
  ],
  exports: [AUTH, AuthService, AuthRateLimiter, TurnstileService, WhatsAppLoginService],
})
export class AuthModule {}
