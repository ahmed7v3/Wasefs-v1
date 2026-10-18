import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { runtime } from "./runtime";

import type { Redis } from "ioredis";

/*
 * Seeds for the Phase 3 Milestone B/C specs (withdrawals, user 360, growth, deals): a setting merged
 * with the owner role and announced on the API's invalidation channel, a cash points balance through
 * the points ledger, a personal offer, an organisation. The same owner-role script runner as
 * `support/billing.ts`.
 */

const DB_DIR = fileURLToPath(new URL("../../../../packages/db/", import.meta.url));
const WORKER_DIR = fileURLToPath(new URL("../../../../apps/worker/", import.meta.url));

function sql(script: string, params: object = {}): string {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: DB_DIR,
    env: { ...process.env, DATABASE_URL: runtime().ownerDatabaseUrl, P: JSON.stringify(params) },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`growth seed failed: ${result.stdout}${result.stderr}`);
  return result.stdout.trim();
}

/** Merges `value` into the `key` setting and tells every API instance to drop its cached copy. */
export async function mergeSetting(redis: Redis, key: string, value: object): Promise<void> {
  sql(
    `import postgres from "postgres";
const p = JSON.parse(process.env.P);
const db = postgres(process.env.DATABASE_URL);
await db\`insert into site_settings (key, value) values (\${p.key}, \${db.json(p.value)})
  on conflict (key) do update set value = site_settings.value || \${db.json(p.value)}\`;
await db.end();`,
    { key, value },
  );
  await redis.publish("settings:invalidate", key);
}

/** Gives `email` a cash points balance with a balanced ledger row (an admin adjustment). */
export function fundCashPoints(email: string, points: number): void {
  sql(
    `import postgres from "postgres";
const p = JSON.parse(process.env.P);
const db = postgres(process.env.DATABASE_URL);
const [u] = await db\`select id from users where email = \${p.email}\`;
const [w] = await db\`insert into points_wallets (user_id, cash, lifetime_earned) values (\${u.id}, \${p.points}, \${p.points})
  on conflict (user_id) do update set cash = points_wallets.cash + \${p.points}, lifetime_earned = points_wallets.lifetime_earned + \${p.points}
  returning id\`;
await db\`insert into points_ledger (wallet_id, group_id, kind, bucket, amount, idempotency_key, reason)
  values (\${w.id}, \${p.group}, 'admin_adjust', 'cash', \${p.points}, \${"e2e:" + p.group}, 'e2e seed')\`;
await db.end();`,
    { email, points, group: randomUUID() },
  );
}

/** Turns a seeded payout method on (they ship disabled until the accountant's answer). */
export function enablePayoutMethod(key: string): void {
  sql(
    `import postgres from "postgres";
const p = JSON.parse(process.env.P);
const db = postgres(process.env.DATABASE_URL);
await db\`update payout_methods set enabled = true where key = \${p.key}\`;
await db.end();`,
    { key },
  );
}

/** An open personal offer (20% off) for `email` that ends in `hours`; returns its server deadline. */
export function seedPersonalOffer(email: string, hours: number): string {
  return sql(
    `import postgres from "postgres";
const p = JSON.parse(process.env.P);
const db = postgres(process.env.DATABASE_URL);
const [u] = await db\`select id from users where email = \${p.email}\`;
const [promo] = await db\`insert into promotions (kind, name, title_ar, title_en, value, status, months)
  values ('percent', 'E2E welcome', 'خصم الترحيب', 'Welcome discount', 2000, 'draft', '{1}') returning id\`;
const [o] = await db\`insert into personal_offers (owner_user_id, kind, promotion_id, rule_key, expires_at)
  values (\${u.id}, 'welcome', \${promo.id}, 'welcome_offer', now() + make_interval(hours => \${p.hours})) returning expires_at\`;
process.stdout.write(new Date(o.expires_at).toISOString());
await db.end();`,
    { email, hours },
  );
}

/** An organisation with `email` as its admin; returns the organisation id. */
export function seedOrganization(name: string, adminEmail: string): string {
  return sql(
    `import postgres from "postgres";
const p = JSON.parse(process.env.P);
const db = postgres(process.env.DATABASE_URL);
const [u] = await db\`select id from users where email = \${p.email}\`;
const [o] = await db\`insert into organizations (name, type, country, created_by) values (\${p.name}, 'pharmacy', 'EG', \${u.id}) returning id\`;
await db\`insert into organization_members (org_id, user_id, role) values (\${o.id}, \${u.id}, 'org_admin')\`;
process.stdout.write(o.id);
await db.end();`,
    { name, email: adminEmail },
  );
}

/** The newest audit rows of `action` for a target, as action names (for the audit-log assertions). */
export function auditActions(targetId: string): string[] {
  const out = sql(
    `import postgres from "postgres";
const p = JSON.parse(process.env.P);
const db = postgres(process.env.DATABASE_URL);
const rows = await db\`select action from audit_logs where target_id = \${p.id} order by created_at desc limit 50\`;
process.stdout.write(JSON.stringify(rows.map((row) => row.action)));
await db.end();`,
    { id: targetId },
  );
  return JSON.parse(out || "[]") as string[];
}

/** Ends the hold of every pending reward of `email` now, as if the hold days had passed. */
export function endRewardHolds(email: string): void {
  sql(
    `import postgres from "postgres";
const p = JSON.parse(process.env.P);
const db = postgres(process.env.DATABASE_URL);
await db\`update points_ledger set release_at = now() - interval '1 minute'
  where kind = 'reward_pending' and release_at is not null
    and wallet_id = (select w.id from points_wallets w join users u on u.id = w.user_id where u.email = \${p.email})\`;
await db.end();`,
    { email },
  );
}

/**
 * Runs one worker job now (instead of waiting for its schedule) and waits until the worker has
 * finished it. Uses the worker's own BullMQ, against the stack's Redis.
 */
export function runWorkerJob(queue: string, name: string, data: object = {}): void {
  const script = `import { Queue, QueueEvents } from "bullmq";
const p = JSON.parse(process.env.P);
const connection = { url: process.env.REDIS_URL };
const queue = new Queue(p.queue, { connection });
const events = new QueueEvents(p.queue, { connection });
await events.waitUntilReady();
const job = await queue.add(p.name, p.data, { removeOnComplete: true, removeOnFail: true });
await job.waitUntilFinished(events, 60_000);
await Promise.all([queue.close(), events.close()]);`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: WORKER_DIR,
    env: { ...process.env, REDIS_URL: runtime().redisUrl, P: JSON.stringify({ queue, name, data }) },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`worker job ${name} failed: ${result.stdout}${result.stderr}`);
}
