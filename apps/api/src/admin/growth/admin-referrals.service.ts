import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { initialsOf } from "@wasfa/shared/rewards";
import {
  referralOverviewSchema,
  referralTreeSchema,
  TREE_MAX_ANCESTORS,
  TREE_MAX_NODES,
  type ReferralOverview,
  type ReferralOverviewQuery,
  type ReferralTree,
  type ReferralTreeQuery,
} from "@wasfa/shared/schemas/admin-growth";
import { Redis } from "ioredis";

import { REDIS } from "../../common/redis.js";
import { csvRow } from "../ai/usage-csv.js";

import { AdminReferralsRepo, type TreeRow, type Window } from "./admin-referrals.repo.js";
import { AdminRewardConfigRepo } from "./admin-reward-config.repo.js";

const DAY_MS = 86_400_000;
const CACHE_SECONDS = 60;
const DEFAULT_RANGE_DAYS = 30;
const TOP_REFERRERS = 10;

type TreeNode = ReferralTree["root"];

const asNode = (row: TreeRow, parentUserId: string | null, depth: number): TreeNode => ({
  userId: row.userId,
  initials: initialsOf(row.name),
  status: row.status,
  fraudFlags: row.flags,
  fraudScore: row.fraudScore,
  pointsEarned: row.pointsEarned,
  paidOrders: row.paidOrders,
  parentUserId,
  depth,
});

@Injectable()
export class AdminReferralsService {
  constructor(
    private readonly repo: AdminReferralsRepo,
    private readonly config: AdminRewardConfigRepo,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * One cached document per range for a minute (the page polls; the aggregates scan the ledger and
   * orders). The default range is keyed by name, its bounds move every second.
   */
  async overview(query: ReferralOverviewQuery): Promise<ReferralOverview> {
    const custom =
      query.from !== undefined && query.to !== undefined
        ? { from: query.from, to: query.to }
        : null;
    const key = custom
      ? `admin:referrals:overview:${custom.from.toISOString()}:${custom.to.toISOString()}`
      : "admin:referrals:overview:default";
    const cached = await this.redis.get(key);
    if (cached) return referralOverviewSchema.parse(JSON.parse(cached));

    const now = new Date();
    const window: Window = custom ?? {
      from: new Date(now.getTime() - DEFAULT_RANGE_DAYS * DAY_MS),
      to: now,
    };
    const [funnel, ledger, paidOut, top, share, settings] = await Promise.all([
      this.repo.funnel(window),
      this.repo.ledgerTotals(window),
      this.repo.paidOut(window),
      this.repo.topReferrers(window, TOP_REFERRERS),
      this.repo.revenueShare(window),
      this.config.rewardsSettings(),
    ]);
    const value = (points: number) => ({ points, valueMinor: points * settings.pointValueMinor });
    const response = referralOverviewSchema.parse({
      generatedAt: now.toISOString(),
      range: { from: window.from.toISOString(), to: window.to.toISOString() },
      currency: settings.currency,
      funnel,
      rewards: {
        accrued: value(ledger.accrued),
        released: value(ledger.released),
        reversed: value(ledger.reversed),
        paidOut,
      },
      topReferrers: top.map((row) => ({
        userId: row.userId,
        initials: initialsOf(row.name),
        paidReferrals: row.paidReferrals,
        points: row.points,
      })),
      revenueShare: share.map((row) => ({
        currency: row.currency,
        referralNetMinor: row.referralNetMinor,
        totalNetMinor: row.totalNetMinor,
        shareBps:
          row.totalNetMinor === 0
            ? 0
            : Math.floor((row.referralNetMinor * 10_000) / row.totalNetMinor),
      })),
    });
    await this.redis.set(key, JSON.stringify(response), "EX", CACHE_SECONDS);
    return response;
  }

  /**
   * The user's referrer chain upward (at most 5) and invitees downward to `depth` (at most 3), no
   * more than 200 downward nodes; `truncated` says the cap cut the tree. Initials only: no email,
   * phone or full name ever leaves this method.
   */
  async tree(query: ReferralTreeQuery): Promise<ReferralTree> {
    if (!(await this.repo.userExists(query.userId))) throw new AppError(ErrorCode.NOT_FOUND);

    const chain: string[] = [];
    const seen = new Set<string>([query.userId]);
    let cursor: string | null = query.userId;
    while (chain.length < TREE_MAX_ANCESTORS) {
      const up: string | null = await this.repo.referrerOf(cursor);
      if (up === null || seen.has(up)) break;
      chain.push(up);
      seen.add(up);
      cursor = up;
    }

    const links: Array<{ userId: string; parent: string; depth: number }> = [];
    let truncated = false;
    let frontier = [query.userId];
    for (let depth = 1; depth <= query.depth && frontier.length > 0; depth++) {
      const room = TREE_MAX_NODES - links.length;
      const found = await this.repo.inviteesOf(frontier, room + 1);
      const fresh = found.filter((row) => !seen.has(row.invitee));
      if (fresh.length > room) truncated = true;
      const taken = fresh.slice(0, room);
      for (const row of taken) {
        seen.add(row.invitee);
        links.push({ userId: row.invitee, parent: row.referrer, depth });
      }
      frontier = taken.map((row) => row.invitee);
      if (truncated) break;
    }

    const rows = new Map(
      (await this.repo.treeRows([query.userId, ...chain, ...links.map((link) => link.userId)])).map(
        (row) => [row.userId, row],
      ),
    );
    const node = (userId: string, parent: string | null, depth: number): TreeNode[] => {
      const row = rows.get(userId);
      return row ? [asNode(row, parent, depth)] : [];
    };
    const root = node(query.userId, chain[0] ?? null, 0)[0];
    if (!root) throw new AppError(ErrorCode.NOT_FOUND);
    return referralTreeSchema.parse({
      root,
      // Nearest first; the last one has no inviter inside the response.
      ancestors: chain.flatMap((userId, index) =>
        node(userId, chain[index + 1] ?? null, -(index + 1)),
      ),
      descendants: links.flatMap((link) => node(link.userId, link.parent, link.depth)),
      truncated,
    });
  }

  /** `finance.export`: the tree as formula-safe CSV, ids and initials only. */
  async treeCsv(query: ReferralTreeQuery): Promise<string[]> {
    // Built whole (at most ~210 rows) so a missing user is a clean 404, not a broken download.
    const tree = await this.tree(query);
    const out = [
      csvRow([
        "user_id",
        "relation",
        "depth",
        "parent_user_id",
        "initials",
        "status",
        "fraud_flags",
        "fraud_score",
        "points_earned",
        "paid_orders",
      ]),
    ];
    const lines: Array<[string, TreeNode]> = [
      ...tree.ancestors.map((node): [string, TreeNode] => ["ancestor", node]),
      ["root", tree.root],
      ...tree.descendants.map((node): [string, TreeNode] => ["invitee", node]),
    ];
    for (const [relation, node] of lines) {
      out.push(
        csvRow([
          node.userId,
          relation,
          node.depth,
          node.parentUserId,
          node.initials,
          node.status,
          node.fraudFlags.join(" "),
          node.fraudScore,
          node.pointsEarned,
          node.paidOrders,
        ]),
      );
    }
    return out;
  }
}
