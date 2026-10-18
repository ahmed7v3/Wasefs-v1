import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { PinoLogger } from "nestjs-pino";

import { AuthService } from "../../auth/auth.service.js";
import { AuthRateLimiter } from "../../auth/rate-limiter.js";
import { TurnstileService } from "../../auth/turnstile.js";

import { LeadsRepo } from "./leads.repo.js";

import type { Locale } from "@wasfa/shared/i18n";
import type { InstitutionLeadInput } from "@wasfa/shared/schemas/org";
import type { IncomingHttpHeaders } from "node:http";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
/** The contact form's limits: per IP per hour, per IP per day, and across the site per hour. */
const IP_HOUR_LIMIT = 5;
const IP_DAY_LIMIT = 20;
const GLOBAL_HOUR_LIMIT = 300;

export interface LeadContext {
  ip: string;
  turnstileToken: string | undefined;
  locale: Locale;
  headers: IncomingHttpHeaders;
}

/** «اطلب عرضًا خاصًا»: a public form that leaves a message in the admin inbox and a draft deal to work on. */
@Injectable()
export class LeadsService {
  constructor(
    private readonly repo: LeadsRepo,
    private readonly limiter: AuthRateLimiter,
    private readonly turnstile: TurnstileService,
    private readonly auth: AuthService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("InstitutionLeads");
  }

  async submit(input: InstitutionLeadInput, context: LeadContext): Promise<{ received: true }> {
    // Limits first, so a bot cannot spend our Turnstile quota; all of them fail closed.
    await this.limiter.hit(`lead:ip:${context.ip}`, IP_HOUR_LIMIT, HOUR);
    await this.limiter.hit(`lead:ip-day:${context.ip}`, IP_DAY_LIMIT, DAY);
    await this.limiter.hit("lead:global", GLOBAL_HOUR_LIMIT, HOUR);

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
    const message = [
      `Institution: ${input.orgName}`,
      `Contact: ${input.contactName}`,
      `Seats: ${String(input.seats)}`,
      ...(input.message === "" ? [] : ["", input.message]),
    ].join("\n");
    const stored = await this.repo.create(
      {
        name: input.contactName,
        email: input.email,
        phone: input.phone,
        topic: "institution_lead",
        message,
        locale: context.locale,
        userId,
      },
      { name: `Lead: ${input.orgName}`, createdBy: userId },
    );
    // Ids only: a log line must not become a second copy of the lead.
    this.logger.info(
      { messageId: stored.messageId, dealId: stored.dealId },
      "institution lead stored",
    );
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
