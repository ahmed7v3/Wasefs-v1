import { Injectable } from "@nestjs/common";

import { AdminStatsRepo } from "./admin-stats.repo.js";

import type { AdminStats } from "@wasfa/shared/schemas/admin";

@Injectable()
export class AdminStatsService {
  constructor(private readonly repo: AdminStatsRepo) {}

  async stats(): Promise<AdminStats> {
    const [users, orgs, open] = await Promise.all([
      this.repo.userCounts(),
      this.repo.orgCount(),
      this.repo.openIssueCount(),
    ]);
    return { users, orgs: { total: orgs }, issues: { open } };
  }
}
