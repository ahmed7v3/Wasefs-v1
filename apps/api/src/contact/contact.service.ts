import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { PinoLogger } from "nestjs-pino";

import { AuthService } from "../auth/auth.service.js";
import { AuthRateLimiter } from "../auth/rate-limiter.js";
import { TurnstileService } from "../auth/turnstile.js";

import { ContactRepo } from "./contact.repo.js";

import type { Locale } from "@wasfa/shared/i18n";
import type { ContactMessageInput, ContactResponse } from "@wasfa/shared/schemas/contact";
import type { IncomingHttpHeaders } from "node:http";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
/** Messages per IP per hour, per IP per day, and across the whole site per hour. */
const IP_HOUR_LIMIT = 5;
const IP_DAY_LIMIT = 20;
const GLOBAL_HOUR_LIMIT = 300;

export interface ContactContext {
  ip: string;
  turnstileToken: string | undefined;
  locale: Locale;
  headers: IncomingHttpHeaders;
}

@Injectable()
export class ContactService {
  constructor(
    private readonly repo: ContactRepo,
    private readonly limiter: AuthRateLimiter,
    private readonly turnstile: TurnstileService,
    private readonly auth: AuthService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("Contact");
  }

  async submit(input: ContactMessageInput, context: ContactContext): Promise<ContactResponse> {
    // Limits first, so a bot cannot spend our Turnstile quota; all of them fail closed.
    await this.limiter.hit(`contact:ip:${context.ip}`, IP_HOUR_LIMIT, HOUR);
    await this.limiter.hit(`contact:ip-day:${context.ip}`, IP_DAY_LIMIT, DAY);
    await this.limiter.hit("contact:global", GLOBAL_HOUR_LIMIT, HOUR);

    if (this.turnstile.enabled) {
      if (!context.turnstileToken) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, {
          details: { reason: "turnstile_required" },
        });
      }
      if (!(await this.turnstile.verify(context.turnstileToken, context.ip))) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, {
          details: { reason: "turnstile_failed" },
        });
      }
    }

    const userId = await this.signedInUserId(context.headers);
    await this.repo.insert({
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      topic: input.topic,
      message: input.message,
      locale: context.locale,
      userId,
    });
    // No name, address, number or text here: a log line must not become a second copy of the message.
    this.logger.info({ topic: input.topic, signedIn: userId !== null }, "contact message stored");
    return { received: true };
  }

  /** The route is public, so a missing or broken session is never an error here. */
  private async signedInUserId(headers: IncomingHttpHeaders): Promise<string | null> {
    try {
      return (await this.auth.getSession(headers))?.user.id ?? null;
    } catch {
      return null;
    }
  }
}
