import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { decodeCursor, toPage } from "../common/keyset.js";

import { AdminOrgsRepo, type OrgRow } from "./admin-orgs.repo.js";

import type { AdminOrg, AdminOrgDetail, AdminOrgListQuery } from "@wasfa/shared/schemas/admin";

const toAdminOrg = (row: OrgRow): AdminOrg => ({
  id: row.id,
  name: row.name,
  type: row.type,
  country: row.country,
  city: row.city,
  memberCount: row.memberCount,
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class AdminOrgsService {
  constructor(private readonly repo: AdminOrgsRepo) {}

  async list(query: AdminOrgListQuery) {
    const rows = await this.repo.list(query.q, decodeCursor(query.cursor, "uuid"), query.limit);
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.id }));
    return { items: page.items.map(toAdminOrg), nextCursor: page.nextCursor };
  }

  async detail(orgId: string): Promise<AdminOrgDetail> {
    const org = await this.repo.find(orgId);
    if (!org) throw new AppError(ErrorCode.NOT_FOUND);
    const [members, pendingInvites] = await Promise.all([
      this.repo.members(orgId),
      this.repo.pendingInvites(orgId),
    ]);
    return {
      ...toAdminOrg(org),
      members: members.map((member) => ({
        userId: member.userId,
        name: member.name,
        role: member.role,
        joinedAt: member.joinedAt.toISOString(),
      })),
      pendingInvites,
    };
  }
}
