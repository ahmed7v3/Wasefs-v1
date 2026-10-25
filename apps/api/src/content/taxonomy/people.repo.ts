import { Inject, Injectable } from "@nestjs/common";
import {
  contentCategories,
  contentItems,
  contentPeople,
  users,
  type ContentPerson,
} from "@wasfa/db";
import { and, asc, count, eq, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import { enqueueContentChanged } from "./content-events.js";

import type { PersonReferences } from "./taxonomy-rules.js";
import type { PersonInput } from "@wasfa/shared/schemas/content";

export type PersonRow = ContentPerson & { itemCount: number };

const personItemCount = sql<number>`(select count(*)::int from ${contentItems} where ${contentItems.primaryAuthorId} = "content_people"."id" or ${contentItems.reviewerId} = "content_people"."id")`;

/** Authors and reviewers (public profiles). Platform data, admin routes only. */
@Injectable()
export class PeopleRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async list(): Promise<PersonRow[]> {
    const rows = await this.handle.db
      .select({ person: contentPeople, itemCount: personItemCount })
      .from(contentPeople)
      .orderBy(asc(contentPeople.nameAr));
    return rows.map((row) => ({ ...row.person, itemCount: row.itemCount }));
  }

  async find(id: string): Promise<PersonRow | undefined> {
    const [row] = await this.handle.db
      .select({ person: contentPeople, itemCount: personItemCount })
      .from(contentPeople)
      .where(eq(contentPeople.id, id));
    return row === undefined ? undefined : { ...row.person, itemCount: row.itemCount };
  }

  /** The profile linked to an account (the reviewer inbox's "mine"), when there is one. */
  async idForUser(userId: string): Promise<string | null> {
    const [row] = await this.handle.db
      .select({ id: contentPeople.id })
      .from(contentPeople)
      .where(eq(contentPeople.userId, userId));
    return row?.id ?? null;
  }

  async userExists(userId: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId));
    return row !== undefined;
  }

  async references(id: string): Promise<PersonReferences> {
    const items = this.handle.db;
    const [categories] = await items
      .select({ total: count() })
      .from(contentCategories)
      .where(eq(contentCategories.defaultReviewerId, id));
    const [asReviewer] = await items
      .select({ total: count() })
      .from(contentItems)
      .where(eq(contentItems.reviewerId, id));
    const [asAuthor] = await items
      .select({ total: count() })
      .from(contentItems)
      .where(eq(contentItems.primaryAuthorId, id));
    const [inReview] = await items
      .select({ total: count() })
      .from(contentItems)
      .where(and(eq(contentItems.status, "in_review"), eq(contentItems.reviewerId, id)));
    return {
      categoryCount: categories?.total ?? 0,
      reviewerItemCount: asReviewer?.total ?? 0,
      authorItemCount: asAuthor?.total ?? 0,
      inReviewCount: inReview?.total ?? 0,
    };
  }

  async insert(input: PersonInput): Promise<{ row: ContentPerson; eventKey: string }> {
    return this.handle.db.transaction(async (tx) => {
      const [row] = await tx.insert(contentPeople).values(input).returning();
      if (row === undefined) throw new Error("insert returned no row");
      return { row, eventKey: await enqueueContentChanged(tx, "taxonomy", `person:${row.id}`) };
    });
  }

  async update(
    id: string,
    input: PersonInput,
  ): Promise<{ row: ContentPerson; eventKey: string } | undefined> {
    return this.handle.db.transaction(async (tx) => {
      const [row] = await tx
        .update(contentPeople)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(contentPeople.id, id))
        .returning();
      if (row === undefined) return undefined;
      return { row, eventKey: await enqueueContentChanged(tx, "taxonomy", `person:${id}`) };
    });
  }

  async remove(id: string): Promise<string | undefined> {
    return this.handle.db.transaction(async (tx) => {
      const rows = await tx.delete(contentPeople).where(eq(contentPeople.id, id)).returning();
      return rows.length === 0 ? undefined : enqueueContentChanged(tx, "taxonomy", `person:${id}`);
    });
  }
}
