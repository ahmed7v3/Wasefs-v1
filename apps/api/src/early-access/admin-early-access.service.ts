import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  arabCountry,
  EARLY_EVENT_TYPES,
  EARLY_FEATURES,
  type AdminEarlyFilter,
  type AdminEarlyLink,
  type AdminEarlyLinkCreate,
  type AdminEarlyOverview,
  type AdminEarlySignup,
  type AdminEarlySignupPatch,
  type AdminEarlySignupsQuery,
  type AdminEarlySignupsResponse,
  type EarlyFeature,
} from "@wasfa/shared/schemas/early-access";

import { csvRow } from "../admin/ai/usage-csv.js";

import {
  AdminEarlyAccessRepo,
  type CountRow,
  type EarlyScope,
  type SignupListFilter,
  type SignupListRow,
} from "./admin-early-access.repo.js";

import type { CampaignLink, EarlyAccessEvent } from "@wasfa/db";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 30;
/** Beyond this many days the chart shows only the days that have data. */
const MAX_FILLED_DAYS = 400;
/** Excel needs the byte order mark to read the file as UTF-8 (Arabic names). */
const BOM = "﻿";

type Labelled = { key: string; label: string | null; count: number };

function rangeOf(filter: AdminEarlyFilter, now = new Date()): EarlyScope {
  const to = filter.to ? new Date(filter.to) : now;
  const from = filter.from
    ? new Date(filter.from)
    : new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
  return { from, to, filter };
}

function labelled(rows: CountRow[], label?: (key: string) => string | null): Labelled[] {
  return rows.flatMap((row) =>
    row.key === null ? [] : [{ key: row.key, label: label?.(row.key) ?? null, count: row.n }],
  );
}

function fillDays(from: Date, to: Date, views: Map<string, number>, signups: Map<string, number>) {
  const days = new Set<string>([...views.keys(), ...signups.keys()]);
  if ((to.getTime() - from.getTime()) / DAY_MS <= MAX_FILLED_DAYS) {
    for (
      let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
      t <= to.getTime();
      t += DAY_MS
    ) {
      days.add(new Date(t).toISOString().slice(0, 10));
    }
  }
  return [...days]
    .sort()
    .map((date) => ({ date, views: views.get(date) ?? 0, signups: signups.get(date) ?? 0 }));
}

function toMap(rows: { key: string | null; n: number }[]): Map<string, number> {
  return new Map(rows.flatMap((row) => (row.key === null ? [] : [[row.key, row.n] as const])));
}

function signupDto(row: SignupListRow): AdminEarlySignup {
  const { signup } = row;
  return {
    id: signup.id,
    phoneE164: signup.phoneE164,
    phoneCountry: signup.phoneCountry,
    name: signup.name,
    role: signup.role,
    probePriceMinor: signup.probePriceMinor,
    probeCurrency: signup.probeCurrency,
    probeAnswer: signup.probeAnswer,
    fairPriceMinor: signup.fairPriceMinor,
    features: signup.features.filter((f): f is EarlyFeature =>
      (EARLY_FEATURES as readonly string[]).includes(f),
    ),
    refCode: signup.refCode,
    referredById: signup.referredById,
    invited: row.invited,
    country: signup.country,
    region: signup.region,
    city: signup.city,
    timezone: signup.timezone,
    latApprox: signup.latApprox,
    lonApprox: signup.lonApprox,
    device: signup.device,
    browser: signup.browser,
    os: signup.os,
    lang: signup.lang,
    referrerHost: signup.referrerHost,
    utm: signup.utm,
    campaignLinkId: signup.campaignLinkId,
    campaignName: row.campaignName,
    variant: signup.variant,
    timeToSubmitMs: signup.timeToSubmitMs,
    stepsCompleted: signup.stepsCompleted,
    status: signup.status,
    adminNote: signup.adminNote,
    createdAt: signup.createdAt.toISOString(),
    updatedAt: signup.updatedAt.toISOString(),
  };
}

function linkDto(link: CampaignLink): AdminEarlyLink {
  return {
    id: link.id,
    name: link.name,
    slug: link.slug,
    utm: link.utm,
    active: link.active,
    createdAt: link.createdAt.toISOString(),
  };
}

@Injectable()
export class AdminEarlyAccessService {
  constructor(private readonly repo: AdminEarlyAccessRepo) {}

  async overview(filter: AdminEarlyFilter): Promise<AdminEarlyOverview> {
    const scope = rangeOf(filter);
    const data = await this.repo.overview(scope);

    const funnelCounts = new Map(data.funnel.map((row) => [row.key, row.n]));
    const signupCountry = toMap(data.signupsByCountry);
    const viewCountry = toMap(data.viewsByCountry);
    const countryKeys = new Set([...signupCountry.keys(), ...viewCountry.keys()]);

    const names = new Map(data.campaignRows.map((row) => [row.id, row]));
    const viewCampaign = new Map(data.viewsByCampaign.map((row) => [row.key, row.n]));
    const signupCampaign = new Map(data.signupsByCampaign.map((row) => [row.key, row]));
    const campaignKeys = new Set<string | null>([...viewCampaign.keys(), ...signupCampaign.keys()]);

    const variantViews = new Map(data.viewsByVariant.map((row) => [row.key ?? "none", row.n]));
    const variantSignups = new Map(data.signupsByVariant.map((row) => [row.key ?? "none", row.n]));

    return {
      kpis: {
        views: data.views,
        uniqueVisitors: data.uniqueVisitors,
        phoneSubmits: data.signups,
        completed: data.completed,
        conversionRate:
          data.uniqueVisitors > 0 ? Math.min(1, data.completed / data.uniqueVisitors) : 0,
        today: data.today,
        invitedJoins: data.invitedJoins,
      },
      series: fillDays(scope.from, scope.to, toMap(data.seriesViews), toMap(data.seriesSignups)),
      funnel: EARLY_EVENT_TYPES.map((type) => ({ type, sessions: funnelCounts.get(type) ?? 0 })),
      countries: [...countryKeys]
        .map((key) => ({
          key,
          label: arabCountry(key)?.nameAr ?? null,
          count: signupCountry.get(key) ?? 0,
          views: viewCountry.get(key) ?? 0,
        }))
        .sort((a, b) => b.count - a.count || b.views - a.views),
      cities: data.cities.flatMap((row) =>
        row.key === null ? [] : [{ key: row.key, label: null, count: row.n, country: row.country }],
      ),
      // The role label is translated in the UI; the key is the contract.
      roles: labelled(data.roles),
      devices: labelled(data.devices),
      sources: labelled(data.sources),
      features: labelled(data.features),
      priceCurve: data.priceCurve,
      fairPrice: data.fairPrice.flatMap((row) =>
        row.currency === null
          ? []
          : [{ currency: row.currency, priceMinor: row.priceMinor, count: row.n }],
      ),
      campaigns: [...campaignKeys]
        .map((id) => {
          const meta = id === null ? undefined : names.get(id);
          const signups = signupCampaign.get(id);
          return {
            campaignLinkId: id,
            name: meta?.name ?? null,
            slug: meta?.slug ?? null,
            views: viewCampaign.get(id) ?? 0,
            signups: signups?.n ?? 0,
            completed: signups?.completed ?? 0,
          };
        })
        .sort((a, b) => b.signups - a.signups || b.views - a.views),
      variants: [...new Set([...variantViews.keys(), ...variantSignups.keys()])]
        .sort()
        .map((variant) => ({
          variant,
          views: variantViews.get(variant) ?? 0,
          signups: variantSignups.get(variant) ?? 0,
        })),
    };
  }

  async signups(query: AdminEarlySignupsQuery): Promise<AdminEarlySignupsResponse> {
    const { rows, total } = await this.repo.listSignups(
      this.listFilter(query),
      query.sort,
      query.dir,
      query.pageSize,
      (query.page - 1) * query.pageSize,
    );
    return { items: rows.map(signupDto), total, page: query.page, pageSize: query.pageSize };
  }

  async patchSignup(
    id: string,
    patch: AdminEarlySignupPatch,
  ): Promise<{ before: unknown; after: unknown; signup: AdminEarlySignup }> {
    const before = await this.repo.signupById(id);
    if (!before) throw new AppError(ErrorCode.NOT_FOUND);
    await this.repo.patchSignup(id, {
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.adminNote === undefined ? {} : { adminNote: patch.adminNote }),
    });
    const after = await this.repo.signupById(id);
    if (!after) throw new AppError(ErrorCode.NOT_FOUND);
    return {
      before: { status: before.signup.status, adminNote: before.signup.adminNote },
      after: { status: after.signup.status, adminNote: after.signup.adminNote },
      signup: signupDto(after),
    };
  }

  /** CSV lines, header first, UTF-8 BOM on the very first one. */
  async signupsCsv(query: AdminEarlySignupsQuery): Promise<string[]> {
    const rows = await this.repo.exportSignups(this.listFilter(query));
    return [
      BOM +
        csvRow([
          "id",
          "created_at",
          "phone",
          "phone_country",
          "name",
          "role",
          "status",
          "probe_price_minor",
          "probe_currency",
          "probe_answer",
          "fair_price_minor",
          "fair_price_currency",
          "features",
          "ref_code",
          "invited",
          "referred_by_id",
          "country",
          "region",
          "city",
          "timezone",
          "lat",
          "lon",
          "device",
          "browser",
          "os",
          "lang",
          "referrer_host",
          "utm_source",
          "utm_medium",
          "utm_campaign",
          "campaign",
          "variant",
          "steps_completed",
          "time_to_submit_ms",
          "admin_note",
        ]),
      ...rows.map(({ signup, campaignName, invited }) =>
        csvRow([
          signup.id,
          signup.createdAt.toISOString(),
          signup.phoneE164,
          signup.phoneCountry,
          signup.name,
          signup.role,
          signup.status,
          signup.probePriceMinor,
          signup.probeCurrency,
          signup.probeAnswer,
          signup.fairPriceMinor,
          signup.fairPriceCurrency,
          signup.features.join(";"),
          signup.refCode,
          invited,
          signup.referredById,
          signup.country,
          signup.region,
          signup.city,
          signup.timezone,
          signup.latApprox,
          signup.lonApprox,
          signup.device,
          signup.browser,
          signup.os,
          signup.lang,
          signup.referrerHost,
          signup.utm["source"],
          signup.utm["medium"],
          signup.utm["campaign"],
          campaignName,
          signup.variant,
          signup.stepsCompleted,
          signup.timeToSubmitMs,
          signup.adminNote,
        ]),
      ),
    ];
  }

  async eventsCsv(filter: AdminEarlyFilter): Promise<string[]> {
    const rows: EarlyAccessEvent[] = await this.repo.exportEvents(rangeOf(filter));
    return [
      BOM +
        csvRow([
          "occurred_at",
          "type",
          "session_id",
          "visitor_hash",
          "campaign_link_id",
          "utm_source",
          "utm_medium",
          "utm_campaign",
          "referrer_host",
          "country",
          "region",
          "city",
          "timezone",
          "device",
          "browser",
          "os",
          "lang",
          "variant",
          "is_bot",
        ]),
      ...rows.map((row) =>
        csvRow([
          row.occurredAt.toISOString(),
          row.type,
          row.sessionId,
          row.visitorHash,
          row.campaignLinkId,
          row.utm["source"],
          row.utm["medium"],
          row.utm["campaign"],
          row.referrerHost,
          row.country,
          row.region,
          row.city,
          row.timezone,
          row.device,
          row.browser,
          row.os,
          row.lang,
          row.variant,
          row.isBot,
        ]),
      ),
    ];
  }

  async links(): Promise<AdminEarlyLink[]> {
    return (await this.repo.listLinks()).map(linkDto);
  }

  async createLink(input: AdminEarlyLinkCreate, actorId: string): Promise<AdminEarlyLink> {
    const utm: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.utm ?? {})) {
      if (typeof value === "string" && value !== "") utm[key] = value;
    }
    const created = await this.repo.createLink({
      name: input.name,
      slug: input.slug,
      utm,
      createdBy: actorId,
    });
    if (!created) throw new AppError(ErrorCode.CONFLICT, { details: { reason: "slug_taken" } });
    return linkDto(created);
  }

  async setLinkActive(id: string, active: boolean): Promise<AdminEarlyLink> {
    const updated = await this.repo.setLinkActive(id, active);
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND);
    return linkDto(updated);
  }

  private listFilter(query: AdminEarlySignupsQuery): SignupListFilter {
    return { ...rangeOf(query), q: query.q, status: query.status, completed: query.completed };
  }
}
