import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { flagRulesSchema } from "@wasfa/shared/settings";

import { FlagsService } from "../../flags/flags.service.js";

import { AdminFlagsRepo, type FlagAdminRow } from "./admin-flags.repo.js";

import type { AdminFlag } from "@wasfa/shared/schemas/admin";
import type { FastifyRequest } from "fastify";

function toAdminFlag(row: FlagAdminRow): AdminFlag {
  const parsed = flagRulesSchema.safeParse(row.rules);
  return {
    key: row.key,
    enabled: row.enabled,
    // `{}` is shown as `{ type: "all" }`; rules the evaluator would not understand are shown as stored.
    rules: parsed.success ? parsed.data : row.rules,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Admin side of feature flags; `FlagsService` validates, caches, invalidates and audits the writes. */
@Injectable()
export class AdminFlagsService {
  constructor(
    private readonly flags: FlagsService,
    private readonly repo: AdminFlagsRepo,
  ) {}

  async list(): Promise<{ items: AdminFlag[] }> {
    return { items: (await this.repo.list()).map(toAdminFlag) };
  }

  async put(actorId: string, request: FastifyRequest, key: string, body: unknown) {
    await this.flags.set(key, body, { actorId, request });
    const row = await this.repo.find(key);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    return toAdminFlag(row);
  }

  async remove(actorId: string, request: FastifyRequest, key: string): Promise<void> {
    await this.flags.remove(key, { actorId, request });
  }
}
