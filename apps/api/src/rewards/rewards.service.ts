import { Injectable } from "@nestjs/common";
import { PointsLedgerError } from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { initialsOf, rewardEventOfReason, type RewardEvent } from "@wasfa/shared/rewards";

import { decodeCursor, toPage } from "../admin/common/keyset.js";
import { AuthRateLimiter } from "../auth/rate-limiter.js";
import { ReferralsService } from "../referrals/referrals.service.js";
import { SettingsService } from "../settings/settings.service.js";

import { RewardsRepo, type ActivityRow } from "./rewards.repo.js";

import type { CursorQuery } from "@wasfa/shared/schemas/admin";
import type {
  MeRewards,
  RewardActivityEntry,
  RewardActivityPage,
} from "@wasfa/shared/schemas/rewards";

const CONVERT_LIMIT_PER_HOUR = 10;

interface TierRow {
  key: string;
  nameAr: string;
  nameEn: string;
  bonusBps: number;
  minPaidReferrals: number;
}

const tierView = (row: TierRow | null) =>
  row === null
    ? null
    : {
        key: row.key,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        bonusBps: row.bonusBps,
        minPaidReferrals: row.minPaidReferrals,
      };

function activityEntry(row: ActivityRow, viewerId: string): RewardActivityEntry {
  const event: RewardEvent | null = rewardEventOfReason(row.reason);
  return {
    id: row.id,
    kind: row.kind,
    bucket: row.bucket,
    amount: row.amount,
    labelKey: `rewards.activity.${row.kind}`,
    event,
    // The invited person is only ever "م. أ."; rewards the caller earned as the invited person
    // (welcome credits) name nobody.
    refereeInitials:
      row.refereeUserId !== null && row.refereeUserId !== viewerId && row.refereeName !== null
        ? initialsOf(row.refereeName) || null
        : null,
    releaseAt: row.releaseAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The caller's points, referral progress and conversion (REFERRALS §8.1, §10). */
@Injectable()
export class RewardsService {
  constructor(
    private readonly repo: RewardsRepo,
    private readonly referrals: ReferralsService,
    private readonly settings: SettingsService,
    private readonly limiter: AuthRateLimiter,
  ) {}

  /** `GET /me/rewards`. */
  async overview(userId: string, now = new Date()): Promise<MeRewards> {
    const [code, settings, wallet, pendingReleaseAt, counts, debt] = await Promise.all([
      this.repo.ensureCode(userId),
      this.settings.get("rewards"),
      this.repo.wallet(userId),
      this.repo.soonestRelease(userId),
      this.repo.counts(userId),
      this.repo.openDebt(userId),
    ]);
    const rules = await this.repo.effectiveRules(code.programId, now);
    const offers = (beneficiary: "referrer" | "referee") =>
      rules
        .filter((rule) => rule.beneficiary === beneficiary)
        .map((rule) => ({
          event: rule.event,
          rewardKind: rule.rewardKind,
          value: rule.value,
          redeemableAs: rule.redeemableAs,
          holdDays: rule.holdDays,
          maxRenewals: rule.maxRenewals,
        }));
    const tier = settings.tiersEnabled ? await this.repo.tier(userId, code.programId, now) : null;
    const cash = wallet?.cash ?? 0;
    return {
      enabled: settings.enabled && !settings.killSwitch,
      code: code.code,
      link: this.referrals.linkFor(code.code),
      vanityEdited: code.vanityEdited,
      offers: {
        referrer: offers("referrer"),
        referee: offers("referee"),
        refereeDiscountBps: settings.refereeFirstPaymentDiscountBps,
      },
      balances: {
        pending: wallet?.pending ?? 0,
        pendingReleaseAt: pendingReleaseAt?.toISOString() ?? null,
        cash,
        cashValueMinor: cash * settings.pointValueMinor,
        currency: settings.currency,
        creditOnly: wallet?.creditOnly ?? 0,
        lifetimeEarned: wallet?.lifetimeEarned ?? 0,
      },
      conversion: {
        pointsPerCredit: settings.pointsPerCredit,
        bonusBps: settings.creditConversionBonusBps,
      },
      tier:
        tier === null
          ? null
          : {
              paidReferrals: tier.paidReferrals,
              current: tierView(tier.current),
              next: tierView(tier.next),
            },
      counts,
      debt,
    };
  }

  /** `GET /me/rewards/activity`: every movement with an i18n key and initials, never a contact. */
  async activity(userId: string, query: CursorQuery): Promise<RewardActivityPage> {
    const cursor = decodeCursor(query.cursor, "uuid");
    const rows = await this.repo.activityPage(userId, cursor, query.limit);
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.id }));
    return {
      items: page.items.map((row) => activityEntry(row, userId)),
      nextCursor: page.nextCursor,
    };
  }

  /** `GET /me/rewards/convert/preview`: exactly what a conversion would do right now. */
  async preview(userId: string, points: number) {
    return this.repo.preview(userId, points);
  }

  /** `POST /me/rewards/convert`: 10 an hour per user; a repeated `requestId` converts once. */
  async convert(userId: string, input: { points: number; requestId: string }) {
    await this.limiter.hit(`rewards-convert:user:${userId}`, CONVERT_LIMIT_PER_HOUR, 3600);
    try {
      return await this.repo.convert(userId, input.points, input.requestId);
    } catch (error) {
      if (error instanceof PointsLedgerError) {
        if (error.reason === "invalid_amount") {
          throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["points"] } });
        }
        throw new AppError(ErrorCode.CONFLICT, { details: { reason: error.reason } });
      }
      throw error;
    }
  }
}
