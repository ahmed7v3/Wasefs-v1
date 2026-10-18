import { Inject, Injectable } from "@nestjs/common";
import { plans, promotions, type NewPromotion, type Promotion } from "@wasfa/db";
import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";

import { afterCursor, escapeLike, stamp, type Cursor } from "../admin/common/keyset.js";
import { DB, type DbHandle } from "../common/database.js";

import type {
  CreatePromotionInput,
  DiscountListQuery,
  UpdatePromotionInput,
} from "@wasfa/shared/schemas/billing";

const dateValue = (value: string | null | undefined) =>
  value === undefined || value === null ? value : new Date(value);

@Injectable()
export class PromotionsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  page(query: DiscountListQuery, cursor?: Cursor) {
    const cursorFilter = cursor
      ? afterCursor(promotions.createdAt, promotions.id, cursor, "uuid")
      : undefined;
    const search = query.q ? `%${escapeLike(query.q)}%` : undefined;
    return this.handle.db
      .select({ promotion: promotions, cursorAt: stamp(promotions.createdAt) })
      .from(promotions)
      .where(
        and(
          ...(query.status ? [eq(promotions.status, query.status as Promotion["status"])] : []),
          ...(search ? [ilike(promotions.name, search)] : []),
          ...(cursorFilter ? [cursorFilter] : []),
        ),
      )
      .orderBy(desc(promotions.createdAt), desc(promotions.id))
      .limit(query.limit + 1);
  }

  find(id: string) {
    return this.handle.db.query.promotions.findFirst({ where: eq(promotions.id, id) });
  }

  async planIdsExist(ids: string[]) {
    if (ids.length === 0) return true;
    const rows = await this.handle.db
      .select({ id: plans.id })
      .from(plans)
      .where(inArray(plans.id, ids));
    return rows.length === new Set(ids).size;
  }

  async create(input: CreatePromotionInput, createdBy: string): Promise<Promotion> {
    const values: NewPromotion = {
      ...input,
      startsAt: dateValue(input.startsAt),
      endsAt: dateValue(input.endsAt),
      status: "draft",
      createdBy,
    };
    const [row] = await this.handle.db.insert(promotions).values(values).returning();
    if (!row) throw new Error("Promotion was not stored");
    return row;
  }

  async update(id: string, values: UpdatePromotionInput) {
    const [before] = await this.handle.db.select().from(promotions).where(eq(promotions.id, id));
    if (!before) return { kind: "not_found" as const };
    const { startsAt, endsAt, ...rest } = values;
    const changes = {
      ...rest,
      ...(startsAt !== undefined ? { startsAt: dateValue(startsAt) } : {}),
      ...(endsAt !== undefined ? { endsAt: dateValue(endsAt) } : {}),
      updatedAt: new Date(),
    };
    const [after] = await this.handle.db
      .update(promotions)
      .set(changes)
      .where(and(eq(promotions.id, id), sql`${promotions.status} <> 'ended'`))
      .returning();
    return after ? { kind: "updated" as const, before, after } : { kind: "ended" as const, before };
  }

  async transition(id: string, from: Promotion["status"][], to: Promotion["status"]) {
    const [row] = await this.handle.db
      .update(promotions)
      .set({ status: to, updatedAt: new Date() })
      .where(and(eq(promotions.id, id), inArray(promotions.status, from)))
      .returning();
    return row;
  }

  async remove(id: string) {
    const [row] = await this.handle.db
      .delete(promotions)
      .where(
        and(eq(promotions.id, id), eq(promotions.status, "draft"), eq(promotions.redeemedCount, 0)),
      )
      .returning();
    return row;
  }

  async duplicate(id: string, createdBy: string) {
    const [source] = await this.handle.db.select().from(promotions).where(eq(promotions.id, id));
    if (!source) return undefined;
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      createdBy: _createdBy,
      ...copy
    } = source;
    void [_id, _createdAt, _updatedAt, _createdBy];
    const [row] = await this.handle.db
      .insert(promotions)
      .values({
        ...copy,
        name: `${source.name.slice(0, 113)} (copy)`,
        redeemedCount: 0,
        status: "draft",
        createdBy,
      })
      .returning();
    return row;
  }
}
