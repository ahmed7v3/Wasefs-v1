import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  earlyPriceCurrency,
  toEarlyE164,
  type earlyClientContextSchema,
  type earlyDetailsSchema,
  type EarlyDetailsResponse,
  type earlyEventSchema,
  type EarlyEventType,
  type earlyJoinSchema,
  type EarlyJoinResponse,
  type EarlyLinkResponse,
  type EarlyStatsResponse,
} from "@wasfa/shared/schemas/early-access";
import { PinoLogger } from "nestjs-pino";

import { TurnstileService } from "../auth/turnstile.js";
import { LocalCache } from "../common/local-cache.js";
import { API_ENV } from "../config/config.module.js";
import { SettingsService } from "../settings/settings.service.js";

import {
  EarlyAccessRepo,
  type ActiveCampaign,
  type SignupContextPatch,
} from "./early-access.repo.js";
import {
  extractEarlyContext,
  isBotUserAgent,
  visitorHash,
  type EarlyContext,
} from "./early-context.js";
import {
  newRefCode,
  pickProbe,
  queuePosition,
  signEarlyToken,
  verifyEarlyToken,
} from "./early-token.js";

import type { ApiEnv } from "../config/env.js";
import type { IncomingHttpHeaders } from "node:http";
import type { z } from "zod";

type EarlyClientContext = z.output<typeof earlyClientContextSchema>;
type EarlyEventInput = z.output<typeof earlyEventSchema>;
type EarlyJoinInput = z.output<typeof earlyJoinSchema>;
type EarlyDetailsInput = z.output<typeof earlyDetailsSchema>;

/** Who is asking: the trusted client IP and the raw request headers (geo comes from them). */
export interface EarlyRequestContext {
  ip: string;
  headers: IncomingHttpHeaders;
}

const CAMPAIGN_TTL_MS = 60_000;
const REF_CODE_ATTEMPTS = 5;

function definedUtm(utm: Record<string, string | undefined> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(utm ?? {})) {
    if (typeof value === "string" && value !== "") out[key] = value;
  }
  return out;
}

function userAgentOf(headers: IncomingHttpHeaders): string {
  const value = headers["user-agent"];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

@Injectable()
export class EarlyAccessService {
  private readonly campaigns = new LocalCache<ActiveCampaign>(CAMPAIGN_TTL_MS);
  private readonly secret: string;

  constructor(
    private readonly repo: EarlyAccessRepo,
    private readonly settings: SettingsService,
    private readonly turnstile: TurnstileService,
    private readonly logger: PinoLogger,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.secret = env.BETTER_AUTH_SECRET;
    this.logger.setContext("EarlyAccess");
  }

  /** Funnel beacon. Bots are stored (flagged) so the raw export is honest, and left out of the counts. */
  async ping(input: EarlyEventInput, request: EarlyRequestContext): Promise<void> {
    await this.recordEvent(input.type, input, request, await this.campaignId(input.campaign));
  }

  async join(
    input: EarlyJoinInput,
    request: EarlyRequestContext,
    turnstileToken: string | undefined,
  ): Promise<EarlyJoinResponse> {
    await this.verifyTurnstile(turnstileToken, request.ip);

    const phone = toEarlyE164(input.country, input.phone);
    if (phone === null) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, {
        details: { reason: "early_phone_invalid", field: "phone" },
      });
    }

    const now = new Date();
    const settings = await this.settings.get("earlyAccess");
    const context = extractEarlyContext(request.headers, input);
    const campaignId = await this.campaignId(input.campaign);

    let signup = await this.repo.signupByPhone(phone);
    let existing = signup !== undefined;
    if (signup) {
      await this.repo.updateContext(signup.id, contextPatch(context, input.sessionId));
    } else {
      const currency = earlyPriceCurrency(input.country);
      const probePriceMinor = pickProbe(settings.priceLadders[currency]);
      const referredById = input.ref ? await this.repo.signupIdByRefCode(input.ref) : undefined;
      for (let attempt = 0; attempt < REF_CODE_ATTEMPTS && !signup; attempt += 1) {
        signup = await this.repo.insertSignup({
          phoneE164: phone,
          phoneCountry: input.country,
          variant: input.variant ?? null,
          sessionId: input.sessionId,
          probePriceMinor,
          probeCurrency: currency,
          refCode: newRefCode(),
          referredById: referredById ?? null,
          ...context,
          utm: definedUtm(input.utm),
          campaignLinkId: campaignId ?? null,
          firstSeenAt:
            input.elapsedMs === undefined ? null : new Date(now.getTime() - input.elapsedMs),
          timeToSubmitMs: input.elapsedMs ?? null,
          privacyAckAt: now,
        });
        if (!signup) {
          // Either a concurrent submit of the same phone or a ref-code collision.
          const raced = await this.repo.signupByPhone(phone);
          if (raced) {
            signup = raced;
            existing = true;
          }
        }
      }
      if (!signup) throw new AppError(ErrorCode.INTERNAL);
    }

    await this.recordEvent("phone_submit", input, request, campaignId, now);
    // No phone, no name in the log line.
    this.logger.info({ signupId: signup.id, existing }, "early access join");

    return {
      signupId: signup.id,
      token: signEarlyToken(this.secret, signup.id, now),
      position: await this.position(signup.id),
      refCode: signup.refCode,
      probe: { priceMinor: signup.probePriceMinor, currency: signup.probeCurrency },
      ladder: [...settings.priceLadders[signup.probeCurrency]],
      existing,
    };
  }

  async details(
    id: string,
    token: string | undefined,
    input: EarlyDetailsInput,
    request: EarlyRequestContext,
  ): Promise<EarlyDetailsResponse> {
    if (!verifyEarlyToken(this.secret, token, id, new Date())) {
      throw new AppError(ErrorCode.FORBIDDEN);
    }
    const signup = await this.repo.signupById(id);
    if (!signup) throw new AppError(ErrorCode.NOT_FOUND);

    const settings = await this.settings.get("earlyAccess");
    const ladder: readonly number[] = settings.priceLadders[signup.probeCurrency];
    const fair = input.fairPriceMinor;
    if (fair !== null && !ladder.includes(fair)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, {
        details: { reason: "early_fair_price_invalid", field: "fairPriceMinor" },
      });
    }

    await this.repo.completeDetails(id, {
      name: input.name,
      role: input.role,
      probeAnswer: input.probeAnswer,
      fairPriceMinor: fair,
      // Kept for "free only" too, so the report can still tell which currency the person answered in.
      fairPriceCurrency: signup.probeCurrency,
      features: [...new Set(input.features)],
    });
    await this.recordEvent(
      "details_submit",
      {
        sessionId: signup.sessionId ?? `signup-${id}`,
        utm: {},
        variant: signup.variant ?? undefined,
      },
      request,
      signup.campaignLinkId ?? undefined,
    );
    this.logger.info({ signupId: id }, "early access details");

    return {
      position: await this.position(id),
      refCode: signup.refCode,
      invited: await this.repo.invitedCount(id),
    };
  }

  /** The "N joined" counter; hidden (null) until it is big enough to impress. */
  async stats(): Promise<EarlyStatsResponse> {
    const settings = await this.settings.get("earlyAccess");
    const joined = await this.repo.joinedCount();
    return { joined: joined >= settings.counterMinToShow ? joined : null };
  }

  async link(slug: string): Promise<EarlyLinkResponse> {
    const campaign = await this.activeCampaign(slug);
    if (!campaign) throw new AppError(ErrorCode.NOT_FOUND);
    return { slug: campaign.slug, utm: campaign.utm };
  }

  private async position(id: string): Promise<number> {
    const [rank, invited] = await Promise.all([this.repo.rawRank(id), this.repo.invitedCount(id)]);
    return queuePosition(rank, invited);
  }

  private async activeCampaign(slug: string): Promise<ActiveCampaign | undefined> {
    const cached = this.campaigns.get(slug);
    if (cached) return cached;
    const found = await this.repo.activeCampaignBySlug(slug);
    // Only hits are cached: a stream of random slugs must not grow the map.
    if (found) this.campaigns.set(slug, found);
    return found;
  }

  private async campaignId(slug: string | undefined): Promise<string | undefined> {
    return slug === undefined ? undefined : (await this.activeCampaign(slug))?.id;
  }

  private async recordEvent(
    type: EarlyEventType,
    client: Pick<EarlyClientContext, "sessionId" | "utm"> & Partial<EarlyClientContext>,
    request: EarlyRequestContext,
    campaignLinkId: string | undefined,
    now = new Date(),
  ): Promise<void> {
    const ua = userAgentOf(request.headers);
    const context = extractEarlyContext(request.headers, client);
    await this.repo.insertEvent({
      occurredAt: now,
      sessionId: client.sessionId,
      visitorHash: visitorHash(this.secret, request.ip, ua, now),
      type,
      campaignLinkId: campaignLinkId ?? null,
      utm: definedUtm(client.utm),
      referrerHost: context.referrerHost,
      country: context.country,
      region: context.region,
      city: context.city,
      timezone: context.timezone,
      device: context.device,
      browser: context.browser,
      os: context.os,
      lang: context.lang,
      variant: client.variant ?? null,
      isBot: isBotUserAgent(ua),
    });
  }

  /** Same contract as the apps waitlist: required and checked whenever a secret is configured. */
  private async verifyTurnstile(token: string | undefined, ip: string): Promise<void> {
    if (!this.turnstile.enabled) return;
    if (!token) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, {
        details: { reason: "turnstile_required" },
      });
    }
    if (!(await this.turnstile.verify(token, ip))) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { reason: "turnstile_failed" } });
    }
  }
}

/** Only what is known now; a missing header must not blank out what an earlier visit recorded. */
function contextPatch(context: EarlyContext, sessionId: string): SignupContextPatch {
  const patch: SignupContextPatch = { sessionId };
  const keys = [
    "country",
    "region",
    "city",
    "timezone",
    "latApprox",
    "lonApprox",
    "device",
    "browser",
    "os",
    "lang",
  ] as const;
  for (const key of keys) {
    const value = context[key];
    if (value !== null) Object.assign(patch, { [key]: value });
  }
  return patch;
}
