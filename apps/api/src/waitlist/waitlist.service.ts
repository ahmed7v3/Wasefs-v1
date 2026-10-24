import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { PinoLogger } from "nestjs-pino";

import { csvRow } from "../admin/ai/usage-csv.js";
import { decodeCursor, toPage } from "../admin/common/keyset.js";
import { AuthRateLimiter } from "../auth/rate-limiter.js";
import { TurnstileService } from "../auth/turnstile.js";
import { SettingsService } from "../settings/settings.service.js";

import { WaitlistRepo } from "./waitlist.repo.js";

import type {
  AdminAppWaitlistQuery,
  AdminAppWaitlistResponse,
  appWaitlistSchema,
} from "@wasfa/shared/schemas/public-site";
import type { z } from "zod";

type AppWaitlistInput = z.output<typeof appWaitlistSchema>;

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
/** Sign-ups per IP per hour and per day, and across the whole site per hour. */
const IP_HOUR_LIMIT = 5;
const IP_DAY_LIMIT = 20;
const GLOBAL_HOUR_LIMIT = 500;

export interface WaitlistContext {
  ip: string;
  turnstileToken: string | undefined;
}

@Injectable()
export class WaitlistService {
  constructor(
    private readonly repo: WaitlistRepo,
    private readonly settings: SettingsService,
    private readonly limiter: AuthRateLimiter,
    private readonly turnstile: TurnstileService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("AppWaitlist");
  }

  /**
   * Adds an address. The answer is the same whether it was new or already listed, so the form cannot
   * be used to probe the list. Refused with 404 while the switch (`landing.apps.waitlistEnabled`)
   * is off: the feature does not exist then. Limits first, so a bot cannot spend the Turnstile quota.
   */
  async join(input: AppWaitlistInput, context: WaitlistContext): Promise<void> {
    const landing = await this.settings.get("landing");
    if (!landing.apps.waitlistEnabled) throw new AppError(ErrorCode.NOT_FOUND);

    await this.limiter.hit(`waitlist:ip:${context.ip}`, IP_HOUR_LIMIT, HOUR);
    await this.limiter.hit(`waitlist:ip-day:${context.ip}`, IP_DAY_LIMIT, DAY);
    await this.limiter.hit("waitlist:global", GLOBAL_HOUR_LIMIT, HOUR);

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

    const created = await this.repo.join({
      email: input.email.trim().toLowerCase(),
      platform: input.platform,
      locale: input.locale,
      consentAt: new Date(),
    });
    // There is no domain-event bus for this yet (`app_waitlist_joined`); a log line without the address is the trace.
    this.logger.info({ platform: input.platform, created }, "app waitlist join");
  }

  async list(query: AdminAppWaitlistQuery): Promise<AdminAppWaitlistResponse> {
    const [rows, total] = await Promise.all([
      this.repo.list(query.platform, decodeCursor(query.cursor, "uuid"), query.limit),
      this.repo.total(),
    ]);
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.id }));
    return {
      items: page.items.map((row) => ({
        id: row.id,
        email: row.email,
        platform: row.platform,
        locale: row.locale,
        consentAt: row.consentAt.toISOString(),
        notifiedAt: row.notifiedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
      total,
    };
  }

  /** CSV lines (header first); cells that could run as formulas are defused by `csvRow`. */
  async csv(): Promise<string[]> {
    const rows = await this.repo.all();
    return [
      csvRow(["email", "platform", "locale", "consent_at", "notified_at", "created_at"]),
      ...rows.map((row) =>
        csvRow([
          row.email,
          row.platform,
          row.locale,
          row.consentAt.toISOString(),
          row.notifiedAt?.toISOString() ?? null,
          row.createdAt.toISOString(),
        ]),
      ),
    ];
  }
}
