import { Inject, Injectable } from "@nestjs/common";
import { slugRedirects, type SlugRedirect, type Transaction } from "@wasfa/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import {
  afterCursor,
  decodeCursor,
  escapeLike,
  stamp,
  toPage,
  type Page,
} from "../../admin/common/keyset.js";
import { DB, type DbHandle } from "../../common/database.js";

import { enqueueContentChanged } from "./content-events.js";
import {
  planAutoRedirect,
  planRedirect,
  type RedirectEdge,
  type RedirectIssue,
} from "./redirect-rules.js";
import { type PlannedPathMove } from "./taxonomy-rules.js";

import type { RedirectInput } from "@wasfa/shared/schemas/content";

/** Serialises redirect edits: the integrity checks read the whole table, so writers queue up. */
async function lockRedirects(tx: Transaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('slug_redirects'))`);
}

async function loadEdges(tx: Transaction): Promise<RedirectEdge[]> {
  return tx
    .select({
      id: slugRedirects.id,
      fromPath: slugRedirects.fromPath,
      toPath: slugRedirects.toPath,
    })
    .from(slugRedirects);
}

/**
 * Writes the redirects a slug change or a tag merge causes, inside the caller's transaction. Never
 * fails on integrity: it resolves chains, drops redirects that would shadow a live path and skips loops.
 */
export async function applyAutoRedirectsTx(
  tx: Transaction,
  moves: readonly PlannedPathMove[],
  reason: RedirectInput["reason"],
  createdBy: string | null,
): Promise<void> {
  if (moves.length === 0) return;
  await lockRedirects(tx);
  for (const move of moves) {
    const plan = planAutoRedirect({ ...move, existing: await loadEdges(tx) });
    if (plan.remove.length > 0) {
      await tx.delete(slugRedirects).where(inArray(slugRedirects.id, plan.remove));
    }
    if (plan.edge === null) continue;
    if (plan.repoint.length > 0) {
      await tx
        .update(slugRedirects)
        .set({ toPath: plan.edge.toPath, updatedAt: new Date() })
        .where(inArray(slugRedirects.id, plan.repoint));
    }
    await tx
      .insert(slugRedirects)
      .values({ ...plan.edge, reason, createdBy })
      .onConflictDoUpdate({
        target: slugRedirects.fromPath,
        set: { toPath: plan.edge.toPath, reason, updatedAt: new Date() },
      });
  }
}

export type RedirectWrite =
  | { ok: true; row: SlugRedirect; repointed: number; eventKey: string }
  | { ok: false; issue: RedirectIssue };

@Injectable()
export class RedirectsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async find(id: string): Promise<SlugRedirect | undefined> {
    const [row] = await this.handle.db.select().from(slugRedirects).where(eq(slugRedirects.id, id));
    return row;
  }

  async list(query: {
    q?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  }): Promise<Page<SlugRedirect & { cursorAt: string }>> {
    const cursor = decodeCursor(query.cursor, "uuid");
    const like = query.q === undefined ? undefined : `%${escapeLike(query.q)}%`;
    const rows = await this.handle.db
      .select({ row: slugRedirects, cursorAt: stamp(slugRedirects.createdAt) })
      .from(slugRedirects)
      .where(
        and(
          like === undefined
            ? undefined
            : sql`(${slugRedirects.fromPath} ilike ${like} or ${slugRedirects.toPath} ilike ${like})`,
          cursor === undefined
            ? undefined
            : afterCursor(slugRedirects.createdAt, slugRedirects.id, cursor, "uuid"),
        ),
      )
      .orderBy(desc(slugRedirects.createdAt), desc(slugRedirects.id))
      .limit(query.limit + 1);
    return toPage(
      rows.map((r) => ({ ...r.row, cursorAt: r.cursorAt })),
      query.limit,
      (row) => ({ at: row.cursorAt, key: row.id }),
    );
  }

  async allEdges(): Promise<Map<string, string>> {
    const rows = await this.handle.db
      .select({ fromPath: slugRedirects.fromPath, toPath: slugRedirects.toPath })
      .from(slugRedirects);
    return new Map(rows.map((row) => [row.fromPath, row.toPath]));
  }

  /** Create (`id` undefined) or edit a manual redirect, collapsing edges that pointed at the source. */
  async write(
    id: string | undefined,
    input: RedirectInput,
    actorId: string,
  ): Promise<RedirectWrite | undefined> {
    return this.handle.db.transaction(async (tx) => {
      await lockRedirects(tx);
      const existing = (await loadEdges(tx)).filter((edge) => edge.id !== id);
      const plan = planRedirect({ fromPath: input.fromPath, toPath: input.toPath, existing });
      if (!plan.ok) return { ok: false as const, issue: plan.issue };
      if (plan.repoint.length > 0) {
        await tx
          .update(slugRedirects)
          .set({ toPath: input.toPath, updatedAt: new Date() })
          .where(inArray(slugRedirects.id, plan.repoint));
      }
      let row: SlugRedirect | undefined;
      if (id === undefined) {
        [row] = await tx
          .insert(slugRedirects)
          .values({ ...input, createdBy: actorId })
          .returning();
      } else {
        [row] = await tx
          .update(slugRedirects)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(slugRedirects.id, id))
          .returning();
      }
      if (row === undefined) return undefined;
      const eventKey = await enqueueContentChanged(tx, "redirects", row.id, {
        paths: [input.toPath],
        oldPaths: [input.fromPath],
      });
      return { ok: true as const, row, repointed: plan.repoint.length, eventKey };
    });
  }

  async remove(id: string): Promise<{ row: SlugRedirect; eventKey: string } | undefined> {
    return this.handle.db.transaction(async (tx) => {
      const [row] = await tx.delete(slugRedirects).where(eq(slugRedirects.id, id)).returning();
      if (row === undefined) return undefined;
      const eventKey = await enqueueContentChanged(tx, "redirects", row.id, {
        oldPaths: [row.fromPath],
      });
      return { row, eventKey };
    });
  }
}
