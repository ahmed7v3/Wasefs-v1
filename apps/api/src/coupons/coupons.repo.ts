import { Inject, Injectable } from "@nestjs/common";
import {
  couponRedemptions,
  coupons,
  orders,
  organizations,
  plans,
  referralCodes,
  users,
  type Coupon,
  type NewCoupon,
} from "@wasfa/db";
import { and, desc, eq, ilike, inArray, notExists, sql, type SQL } from "drizzle-orm";

import { afterCursor, stamp, type Cursor } from "../admin/common/keyset.js";
import { DB, type DbHandle } from "../common/database.js";

import type {
  BulkCouponInput,
  CreateCouponInput,
  DiscountListQuery,
  UpdateCouponInput,
} from "@wasfa/shared/schemas/billing";

const dateValue = (value: string | null | undefined) =>
  value === undefined || value === null ? value : new Date(value);

const BULK_INSERT_CHUNK = 500;

@Injectable()
export class CouponsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  page(query: DiscountListQuery, cursor?: Cursor) {
    const cursorFilter = cursor
      ? afterCursor(coupons.createdAt, coupons.id, cursor, "uuid")
      : undefined;
    return this.handle.db
      .select({ coupon: coupons, cursorAt: stamp(coupons.createdAt) })
      .from(coupons)
      .where(
        and(
          ...(query.status ? [eq(coupons.status, query.status as Coupon["status"])] : []),
          ...(query.q ? [ilike(coupons.code, `${query.q.replace(/[\\%_]/g, "\\$&")}%`)] : []),
          ...(query.batch ? [eq(coupons.batch, query.batch)] : []),
          ...(cursorFilter ? [cursorFilter] : []),
        ),
      )
      .orderBy(desc(coupons.createdAt), desc(coupons.id))
      .limit(query.limit + 1);
  }

  find(id: string) {
    return this.handle.db.query.coupons.findFirst({ where: eq(coupons.id, id) });
  }

  async detail(id: string) {
    const coupon = await this.find(id);
    if (!coupon) return undefined;
    const rows = await this.handle.db
      .select({
        redemption: couponRedemptions,
        orderNumber: orders.number,
        discountMinor: orders.discountMinor,
      })
      .from(couponRedemptions)
      .innerJoin(orders, eq(orders.id, couponRedemptions.orderId))
      .where(eq(couponRedemptions.couponId, id))
      .orderBy(desc(couponRedemptions.reservedAt), desc(couponRedemptions.id))
      .limit(50);
    return {
      coupon,
      redemptions: rows.flatMap(({ redemption, orderNumber, discountMinor }) => {
        // The table CHECK guarantees exactly one owner; the guard only narrows the type.
        const ownerId = redemption.ownerUserId ?? redemption.ownerOrgId;
        if (ownerId === null) return [];
        return {
          orderNumber,
          ownerType: redemption.ownerUserId !== null ? ("user" as const) : ("org" as const),
          ownerId,
          status: redemption.status,
          reservedAt: redemption.reservedAt,
          confirmedAt: redemption.confirmedAt,
          releasedAt: redemption.releasedAt,
          discountMinor,
        };
      }),
    };
  }

  async planIdsExist(ids: string[]) {
    if (ids.length === 0) return true;
    const rows = await this.handle.db
      .select({ id: plans.id })
      .from(plans)
      .where(inArray(plans.id, ids));
    return rows.length === new Set(ids).size;
  }

  async targetsExist(
    input: Pick<CreateCouponInput, "targetUserId" | "targetOrgId" | "referralCodeId">,
  ) {
    const [user, org, referral] = await Promise.all([
      input.targetUserId
        ? this.handle.db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, input.targetUserId))
        : [true],
      input.targetOrgId
        ? this.handle.db
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.id, input.targetOrgId))
        : [true],
      input.referralCodeId
        ? this.handle.db
            .select({ id: referralCodes.id })
            .from(referralCodes)
            .where(eq(referralCodes.id, input.referralCodeId))
        : [true],
    ]);
    return user.length > 0 && org.length > 0 && referral.length > 0;
  }

  async create(input: CreateCouponInput, createdBy: string): Promise<Coupon> {
    const values: NewCoupon = {
      ...input,
      startsAt: dateValue(input.startsAt),
      endsAt: dateValue(input.endsAt),
      status: "draft",
      createdBy,
    };
    const [row] = await this.handle.db.insert(coupons).values(values).returning();
    if (!row) throw new Error("Coupon was not stored");
    return row;
  }

  async update(id: string, values: UpdateCouponInput) {
    const [before] = await this.handle.db.select().from(coupons).where(eq(coupons.id, id));
    if (!before) return { kind: "not_found" as const };
    const { startsAt, endsAt, ...rest } = values;
    const changes = {
      ...rest,
      ...(startsAt !== undefined ? { startsAt: dateValue(startsAt) } : {}),
      ...(endsAt !== undefined ? { endsAt: dateValue(endsAt) } : {}),
      updatedAt: new Date(),
    };
    const [after] = await this.handle.db
      .update(coupons)
      .set(changes)
      .where(and(eq(coupons.id, id), sql`${coupons.status} <> 'ended'`))
      .returning();
    return after ? { kind: "updated" as const, before, after } : { kind: "ended" as const, before };
  }

  async transition(id: string, from: Coupon["status"][], to: Coupon["status"]) {
    const [row] = await this.handle.db
      .update(coupons)
      .set({ status: to, updatedAt: new Date() })
      .where(and(eq(coupons.id, id), inArray(coupons.status, from)))
      .returning();
    return row;
  }

  async remove(id: string) {
    return this.handle.db
      .delete(coupons)
      .where(
        and(
          eq(coupons.id, id),
          eq(coupons.status, "draft"),
          eq(coupons.redeemedCount, 0),
          notExists(
            this.handle.db
              .select({ id: couponRedemptions.id })
              .from(couponRedemptions)
              .where(eq(couponRedemptions.couponId, coupons.id)),
          ),
        ),
      )
      .returning();
  }

  async bulk(
    input: Omit<BulkCouponInput, "count" | "prefix" | "length">,
    count: number,
    batch: string,
    createdBy: string,
    makeCode: () => string,
    now = new Date(),
  ) {
    return this.handle.db.transaction(async (tx) => {
      let insertedCount = 0;
      for (let round = 0; round < 5 && insertedCount < count; round++) {
        const missing = count - insertedCount;
        const values: NewCoupon[] = Array.from({ length: missing }, () => ({
          ...input,
          code: makeCode(),
          startsAt: dateValue(input.startsAt) ?? null,
          endsAt: dateValue(input.endsAt) ?? null,
          targetUserId: null,
          targetOrgId: null,
          batch,
          status: "draft",
          createdBy,
          createdAt: now,
          updatedAt: now,
        }));
        // Postgres caps a statement at 65535 bind parameters: 5000 wide rows need several inserts.
        for (let offset = 0; offset < values.length; offset += BULK_INSERT_CHUNK) {
          const inserted = await tx
            .insert(coupons)
            .values(values.slice(offset, offset + BULK_INSERT_CHUNK))
            .onConflictDoNothing({ target: coupons.code })
            .returning({ id: coupons.id });
          insertedCount += inserted.length;
        }
      }
      if (insertedCount !== count) throw new Error("coupon_code_collisions");
      return insertedCount;
    });
  }

  batchRows(batch: string) {
    return this.handle.db
      .select()
      .from(coupons)
      .where(eq(coupons.batch, batch))
      .orderBy(coupons.code);
  }

  async transitionBatch(
    batch: string,
    action: "publish" | "pause" | "resume" | "end",
    now = new Date(),
  ) {
    // A bare Date inside sql`` is not encoded by the driver: pass an ISO string with a cast.
    const at = sql`${now.toISOString()}::timestamptz`;
    const validStatuses: Coupon["status"][] =
      action === "publish"
        ? ["draft"]
        : action === "pause"
          ? ["scheduled", "active"]
          : action === "resume"
            ? ["paused"]
            : ["draft", "scheduled", "active", "paused"];
    let target: "active" | "scheduled" | "paused" | "ended";
    if (action === "publish") {
      target = "active";
    } else if (action === "pause") {
      target = "paused";
    } else if (action === "resume") {
      target = "active";
    } else {
      target = "ended";
    }
    const statusCase: SQL<Coupon["status"]> =
      action === "publish"
        ? sql<Coupon["status"]>`case
            when ${coupons.startsAt} > ${at} then 'scheduled'
            else 'active'
          end`
        : action === "resume"
          ? sql<Coupon["status"]>`case
              when ${coupons.endsAt} <= ${at} then 'ended'
              when ${coupons.startsAt} > ${at} then 'scheduled'
              else 'active'
            end`
          : sql<Coupon["status"]>`${target}`;
    const result = await this.handle.db
      .update(coupons)
      .set({ status: statusCase, updatedAt: now })
      .where(
        and(
          eq(coupons.batch, batch),
          inArray(coupons.status, validStatuses),
          ...(action === "publish"
            ? [sql`(${coupons.endsAt} is null or ${coupons.endsAt} > ${at})`]
            : []),
        ),
      )
      .returning({ id: coupons.id });
    return result.length;
  }
}
