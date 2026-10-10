import { Module } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { AuthModule } from "../auth/auth.module.js";
import { REDIS } from "../common/redis.js";

import { InboundConsumer } from "./inbound.consumer.js";
import { WhatsAppInboundVerifier } from "./phone-verifier.js";
import { PhoneController } from "./phone.controller.js";
import { PhoneRepo } from "./phone.repo.js";
import { PhoneService } from "./phone.service.js";
import { PHONE_VERIFIER } from "./phone.tokens.js";

import type { Redis } from "ioredis";

/** Phone verification by inbound WhatsApp (Task 1.5). `PHONE_VERIFIER` is the seam for other methods. */
@Module({
  imports: [AuthModule],
  controllers: [PhoneController],
  providers: [
    PhoneRepo,
    PhoneService,
    InboundConsumer,
    {
      provide: PHONE_VERIFIER,
      inject: [REDIS, PhoneRepo, PinoLogger],
      useFactory: (redis: Redis, repo: PhoneRepo, logger: PinoLogger) => {
        logger.setContext("PhoneVerifier");
        return new WhatsAppInboundVerifier(redis, repo, (level, message) => logger[level](message));
      },
    },
  ],
  exports: [PhoneService],
})
export class PhoneModule {}
