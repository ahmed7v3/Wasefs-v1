import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { decodeCursor, toPage } from "../common/keyset.js";

import { AdminIssuesRepo, type IssueRow } from "./admin-issues.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { Issue, IssueDetail, IssueListQuery, IssueStatus } from "@wasfa/shared/schemas/admin";

const ISSUE_EVENTS_SHOWN = 20;

// Postgres text with microseconds becomes a plain ISO instant (milliseconds) for the client.
const iso = (stamp: string) => new Date(stamp).toISOString();

const toIssue = (row: IssueRow): Issue => ({
  fingerprint: row.fingerprint,
  code: row.code,
  route: row.route,
  method: row.method,
  message: row.message,
  count: row.count,
  affectedUsers: row.affectedUsers,
  firstSeen: iso(row.firstSeen),
  lastSeen: iso(row.lastSeen),
  status: row.status,
  sampleRef: row.sampleRef,
});

@Injectable()
export class AdminIssuesService {
  constructor(private readonly repo: AdminIssuesRepo) {}

  async list(query: IssueListQuery) {
    const rows = await this.repo.list(query.status, decodeCursor(query.cursor, "hex"), query.limit);
    const page = toPage(rows, query.limit, (row) => ({ at: row.lastSeen, key: row.fingerprint }));
    return { items: page.items.map(toIssue), nextCursor: page.nextCursor };
  }

  async detail(fingerprint: string): Promise<IssueDetail> {
    const issue = await this.repo.find(fingerprint);
    if (!issue) throw new AppError(ErrorCode.NOT_FOUND);
    const events = await this.repo.events(fingerprint, ISSUE_EVENTS_SHOWN);
    return {
      ...toIssue(issue),
      events: events.map((event) => ({
        ref: event.ref,
        createdAt: event.createdAt.toISOString(),
        userId: event.userId,
        requestId: event.requestId,
        context: event.context,
        stack: event.stack,
      })),
    };
  }

  /** Sets the status of the whole group (every event of the fingerprint). Audited by the route. */
  async setStatus(fingerprint: string, status: IssueStatus, audit: AuditScope): Promise<Issue> {
    const before = await this.repo.setStatus(fingerprint, status);
    if (before === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    audit.before = { status: before };
    audit.after = { status };
    const issue = await this.repo.find(fingerprint);
    if (!issue) throw new AppError(ErrorCode.NOT_FOUND);
    return toIssue(issue);
  }
}
