import { Inject, Injectable } from "@nestjs/common";
import {
  aiTaskRoutes,
  isUniqueViolation,
  plans,
  type AiTaskRoute,
  type RouteModelEntry,
} from "@wasfa/db";
import { and, eq, isNull } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import type { AiMode, AiTask } from "@wasfa/shared/ai";

export interface RouteRow {
  route: AiTaskRoute;
  planKey: string | null;
}

export interface RouteKey {
  task: AiTask;
  planId: string | null;
  mode: AiMode;
}

export type SaveOutcome =
  | { kind: "saved"; before: AiTaskRoute | undefined; after: AiTaskRoute }
  | { kind: "stale_version" };

const ROUTE_KEY_INDEX = "ai_task_routes_key";

@Injectable()
export class AdminAiRoutesRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  private select() {
    return this.handle.db
      .select({ route: aiTaskRoutes, planKey: plans.key })
      .from(aiTaskRoutes)
      .leftJoin(plans, eq(plans.id, aiTaskRoutes.planId));
  }

  async list(): Promise<RouteRow[]> {
    return await this.select();
  }

  async find(id: string): Promise<RouteRow | undefined> {
    const [row] = await this.select().where(eq(aiTaskRoutes.id, id));
    return row;
  }

  async planKey(planId: string): Promise<string | undefined> {
    const [row] = await this.handle.db
      .select({ key: plans.key })
      .from(plans)
      .where(eq(plans.id, planId));
    return row?.key;
  }

  /**
   * Insert, or replace the model list of the route for this task, plan and mode, bumping its
   * version. `expectedVersion` must match the stored one (an insert expects no row).
   */
  async save(
    key: RouteKey,
    models: RouteModelEntry[],
    expectedVersion: number | undefined,
  ): Promise<SaveOutcome> {
    try {
      return await this.handle.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(aiTaskRoutes)
          .where(
            and(
              eq(aiTaskRoutes.task, key.task),
              eq(aiTaskRoutes.mode, key.mode),
              key.planId === null
                ? isNull(aiTaskRoutes.planId)
                : eq(aiTaskRoutes.planId, key.planId),
            ),
          )
          .for("update");
        if (expectedVersion !== undefined && expectedVersion !== before?.version) {
          return { kind: "stale_version" } as const;
        }
        if (before) {
          const [after] = await tx
            .update(aiTaskRoutes)
            .set({ models, version: before.version + 1 })
            .where(eq(aiTaskRoutes.id, before.id))
            .returning();
          if (!after) throw new Error("Route was not updated");
          return { kind: "saved", before, after } as const;
        }
        const [after] = await tx
          .insert(aiTaskRoutes)
          .values({ ...key, models, version: 1 })
          .returning();
        if (!after) throw new Error("Route was not stored");
        return { kind: "saved", before: undefined, after } as const;
      });
    } catch (error) {
      // Two first saves of the same route at once: the loser sees the winner's row next time.
      if (isUniqueViolation(error, ROUTE_KEY_INDEX)) return { kind: "stale_version" };
      throw error;
    }
  }

  async remove(id: string): Promise<boolean> {
    const rows = await this.handle.db
      .delete(aiTaskRoutes)
      .where(eq(aiTaskRoutes.id, id))
      .returning({ id: aiTaskRoutes.id });
    return rows.length > 0;
  }
}
