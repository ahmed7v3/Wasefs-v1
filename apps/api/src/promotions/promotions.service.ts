import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { promotionListResponseSchema, promotionViewSchema } from "@wasfa/shared/schemas/billing";

import { decodeCursor, toPage } from "../admin/common/keyset.js";

import { PromotionsRepo } from "./promotions.repo.js";

import type { AuditScope } from "../audit/audited.decorator.js";
import type { AuthenticatedUser } from "../common/current-user.js";
import type { Promotion } from "@wasfa/db";
import type {
  CreatePromotionInput,
  DiscountListQuery,
  UpdatePromotionInput,
} from "@wasfa/shared/schemas/billing";

const conflict = () => new AppError(ErrorCode.CONFLICT);
const asView = (row: Promotion) =>
  promotionViewSchema.parse({
    ...row,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
const auditShape = (row: Promotion) => ({ name: row.name, kind: row.kind, status: row.status });

@Injectable()
export class PromotionsService {
  constructor(private readonly repo: PromotionsRepo) {}

  async list(query: DiscountListQuery) {
    const rows = await this.repo.page(query, decodeCursor(query.cursor, "uuid"));
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.promotion.id }));
    return promotionListResponseSchema.parse({
      items: page.items.map(({ promotion }) => asView(promotion)),
      nextCursor: page.nextCursor,
    });
  }

  async get(id: string) {
    const row = await this.repo.find(id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    return asView(row);
  }

  async create(input: CreatePromotionInput, actor: AuthenticatedUser, audit: AuditScope) {
    await this.assertPlans(input.planIds);
    const row = await this.repo.create(input, actor.id);
    audit.targetId = row.id;
    audit.after = auditShape(row);
    return asView(row);
  }

  async update(id: string, input: UpdatePromotionInput, audit: AuditScope) {
    const existing = await this.repo.find(id);
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND);
    if (existing.status === "ended") throw conflict();
    const startsAt = input.startsAt === undefined ? existing.startsAt : input.startsAt;
    const endsAt = input.endsAt === undefined ? existing.endsAt : input.endsAt;
    const showCountdown = input.showCountdown ?? existing.showCountdown;
    this.assertDates(startsAt, endsAt);
    if (showCountdown && endsAt === null) {
      throw new AppError(ErrorCode.VALIDATION_FAILED);
    }
    if (
      input.maxRedemptions !== undefined &&
      input.maxRedemptions !== null &&
      input.maxRedemptions < existing.redeemedCount
    ) {
      throw new AppError(ErrorCode.VALIDATION_FAILED);
    }
    await this.assertPlans(input.planIds ?? existing.planIds);
    try {
      const result = await this.repo.update(id, input);
      if (result.kind === "not_found") throw new AppError(ErrorCode.NOT_FOUND);
      if (result.kind === "ended") throw conflict();
      audit.targetId = id;
      audit.before = auditShape(result.before);
      audit.after = auditShape(result.after);
      return asView(result.after);
    } catch (error) {
      if (this.isRedeemedLimitViolation(error)) throw new AppError(ErrorCode.VALIDATION_FAILED);
      throw error;
    }
  }

  async remove(id: string, audit: AuditScope) {
    const existing = await this.repo.find(id);
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND);
    const deleted = await this.repo.remove(id);
    if (!deleted) throw conflict();
    audit.targetId = id;
    audit.before = auditShape(existing);
  }

  async transition(id: string, action: "publish" | "pause" | "resume" | "end", audit: AuditScope) {
    const now = new Date();
    const current = await this.repo.find(id);
    if (!current) throw new AppError(ErrorCode.NOT_FOUND);
    let from: Promotion["status"][];
    let to: Promotion["status"];
    if (action === "publish") {
      from = ["draft"];
      if (current.endsAt !== null && current.endsAt <= now) throw conflict();
      to = current.startsAt !== null && current.startsAt > now ? "scheduled" : "active";
    } else if (action === "pause") {
      from = ["scheduled", "active"];
      to = "paused";
    } else if (action === "resume") {
      from = ["paused"];
      to =
        current.endsAt !== null && current.endsAt <= now
          ? "ended"
          : current.startsAt !== null && current.startsAt > now
            ? "scheduled"
            : "active";
    } else {
      from = ["draft", "scheduled", "active", "paused"];
      to = "ended";
    }
    const row = await this.repo.transition(id, from, to);
    if (!row) throw conflict();
    audit.targetId = id;
    audit.before = { status: current.status };
    audit.after = { status: row.status };
    return asView(row);
  }

  async duplicate(id: string, actor: AuthenticatedUser, audit: AuditScope) {
    const row = await this.repo.duplicate(id, actor.id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    audit.targetId = row.id;
    audit.after = auditShape(row);
    return asView(row);
  }

  private async assertPlans(ids: string[]) {
    if (!(await this.repo.planIdsExist(ids))) throw new AppError(ErrorCode.VALIDATION_FAILED);
  }

  private assertDates(startsAt: Date | string | null, endsAt: Date | string | null) {
    if (startsAt !== null && endsAt !== null && new Date(endsAt) <= new Date(startsAt)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED);
    }
  }

  private isRedeemedLimitViolation(error: unknown) {
    let current = error;
    for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
      const candidate = current as Error & { constraint_name?: string; cause?: unknown };
      if (candidate.constraint_name === "promotions_redeemed_count_check") return true;
      current = candidate.cause;
    }
    return false;
  }
}
