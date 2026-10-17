import { Injectable } from "@nestjs/common";
import { isUniqueViolation } from "@wasfa/db";
import { generateCouponCode, normalizeCouponCode } from "@wasfa/shared/coupon-codes";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  bulkCouponResponseSchema,
  couponBatchTransitionResponseSchema,
  couponDetailViewSchema,
  couponListResponseSchema,
  couponViewSchema,
} from "@wasfa/shared/schemas/billing";

import { decodeCursor, toPage } from "../admin/common/keyset.js";

import { CouponsRepo } from "./coupons.repo.js";

import type { AuditScope } from "../audit/audited.decorator.js";
import type { AuthenticatedUser } from "../common/current-user.js";
import type { Coupon } from "@wasfa/db";
import type {
  BulkCouponInput,
  CreateCouponInput,
  DiscountListQuery,
  UpdateCouponInput,
} from "@wasfa/shared/schemas/billing";

const conflict = () => new AppError(ErrorCode.CONFLICT);
const invalid = () => new AppError(ErrorCode.VALIDATION_FAILED);
const rowView = (row: Coupon) =>
  couponViewSchema.parse({
    ...row,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
const auditShape = (row: Coupon) => ({
  code: row.code,
  name: row.name,
  kind: row.kind,
  status: row.status,
});

function constraintName(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    const candidate = current as Error & { constraint_name?: string; cause?: unknown };
    if (candidate.constraint_name) return candidate.constraint_name;
    current = candidate.cause;
  }
  return undefined;
}

@Injectable()
export class CouponsService {
  constructor(private readonly repo: CouponsRepo) {}

  async list(query: DiscountListQuery) {
    const rows = await this.repo.page(query, decodeCursor(query.cursor, "uuid"));
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.coupon.id }));
    return couponListResponseSchema.parse({
      items: page.items.map(({ coupon }) => rowView(coupon)),
      nextCursor: page.nextCursor,
    });
  }

  async get(id: string) {
    const detail = await this.repo.detail(id);
    if (!detail) throw new AppError(ErrorCode.NOT_FOUND);
    return couponDetailViewSchema.parse({
      ...rowView(detail.coupon),
      redemptions: detail.redemptions.map((row) => ({
        ...row,
        reservedAt: row.reservedAt.toISOString(),
        confirmedAt: row.confirmedAt?.toISOString() ?? null,
        releasedAt: row.releasedAt?.toISOString() ?? null,
      })),
    });
  }

  async create(input: CreateCouponInput, actor: AuthenticatedUser, audit: AuditScope) {
    await this.assertReferences(input);
    try {
      const row = await this.repo.create(
        { ...input, code: normalizeCouponCode(input.code) },
        actor.id,
      );
      audit.targetId = row.id;
      audit.after = auditShape(row);
      return rowView(row);
    } catch (error) {
      if (isUniqueViolation(error, "coupons_code_key")) throw conflict();
      if (this.isConstraintFailure(error)) throw invalid();
      throw error;
    }
  }

  async update(id: string, input: UpdateCouponInput, audit: AuditScope) {
    const existing = await this.repo.find(id);
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND);
    if (existing.status === "ended") throw conflict();
    const startsAt = input.startsAt === undefined ? existing.startsAt : input.startsAt;
    const endsAt = input.endsAt === undefined ? existing.endsAt : input.endsAt;
    if (startsAt !== null && endsAt !== null && new Date(endsAt) <= new Date(startsAt)) {
      throw invalid();
    }
    if (
      input.maxRedemptions !== undefined &&
      input.maxRedemptions !== null &&
      input.maxRedemptions < existing.redeemedCount
    ) {
      throw invalid();
    }
    await this.assertPlans(input.planIds ?? existing.planIds);
    try {
      const result = await this.repo.update(id, input);
      if (result.kind === "not_found") throw new AppError(ErrorCode.NOT_FOUND);
      if (result.kind === "ended") throw conflict();
      audit.targetId = id;
      audit.before = auditShape(result.before);
      audit.after = auditShape(result.after);
      return rowView(result.after);
    } catch (error) {
      if (this.isConstraintFailure(error)) throw invalid();
      throw error;
    }
  }

  async remove(id: string, audit: AuditScope) {
    const existing = await this.repo.find(id);
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND);
    const result = await this.repo.remove(id);
    if (result.length === 0) throw conflict();
    audit.targetId = id;
    audit.before = auditShape(existing);
  }

  async transition(id: string, action: "publish" | "pause" | "resume" | "end", audit: AuditScope) {
    const now = new Date();
    const current = await this.repo.find(id);
    if (!current) throw new AppError(ErrorCode.NOT_FOUND);
    let from: Coupon["status"][];
    let to: Coupon["status"];
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
    return rowView(row);
  }

  async bulk(input: BulkCouponInput, actor: AuthenticatedUser, audit: AuditScope) {
    await this.assertPlans(input.planIds);
    if (input.referralCodeId !== null) {
      const valid = await this.repo.targetsExist({
        targetUserId: null,
        targetOrgId: null,
        referralCodeId: input.referralCodeId,
      });
      if (!valid) throw invalid();
    }
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replaceAll("-", "");
    const batch = `${date}-${generateCouponCode(6)}`;
    const { count, prefix, length, ...fields } = input;
    try {
      const created = await this.repo.bulk(
        fields,
        count,
        batch,
        actor.id,
        () => generateCouponCode(length, prefix),
        now,
      );
      audit.targetId = batch;
      audit.after = { batch, count: created };
      return bulkCouponResponseSchema.parse({ batch, count: created });
    } catch (error) {
      if (error instanceof Error && error.message === "coupon_code_collisions") throw conflict();
      if (this.isConstraintFailure(error)) throw invalid();
      throw error;
    }
  }

  async exportBatch(batch: string, audit: AuditScope) {
    const rows = await this.repo.batchRows(batch);
    if (rows.length === 0) throw new AppError(ErrorCode.NOT_FOUND);
    audit.targetId = batch;
    audit.after = { count: rows.length };
    const header = "code,status,redeemed_count,max_redemptions,starts_at,ends_at";
    const lines = rows.map((row) =>
      [
        row.code,
        row.status,
        row.redeemedCount,
        row.maxRedemptions ?? "",
        row.startsAt?.toISOString() ?? "",
        row.endsAt?.toISOString() ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
    return `${header}\r\n${lines.join("\r\n")}`;
  }

  async transitionBatch(
    batch: string,
    action: "publish" | "pause" | "resume" | "end",
    audit: AuditScope,
  ) {
    const changed = await this.repo.transitionBatch(batch, action);
    audit.targetId = batch;
    audit.after = { changed };
    return couponBatchTransitionResponseSchema.parse({ changed });
  }

  private async assertReferences(input: CreateCouponInput) {
    await this.assertPlans(input.planIds);
    if (!(await this.repo.targetsExist(input))) throw invalid();
  }

  private async assertPlans(ids: string[]) {
    if (!(await this.repo.planIdsExist(ids))) throw invalid();
  }

  private isConstraintFailure(error: unknown) {
    const name = constraintName(error);
    return name?.startsWith("coupons_") === true && name !== "coupons_code_key";
  }
}

function csvCell(value: string | number): string {
  const text = String(value);
  const escaped = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${escaped.replaceAll('"', '""')}"`;
}
