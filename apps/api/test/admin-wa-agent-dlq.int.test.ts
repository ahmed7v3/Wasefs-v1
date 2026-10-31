import { auditLogs } from "@wasfa/db";
import { WA_AGENT_DLQ_STREAM } from "@wasfa/shared/schemas/phone";
import { waAgentDlqListSchema, waAgentDlqReplaySchema } from "@wasfa/shared/schemas/wa-agent";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, type Admin } from "./support/admin-context.js";

/*
 * The dead-letter endpoints of the WhatsApp agent: listing is `wa_agent.read`, replay and discard
 * are `wa_agent.write` with an audit row that names the entry id and nothing of its payload.
 */

const ctx = new AdminTestContext();
let reader: Admin;
let writer: Admin;
const SOURCE = "wa:agent:test-dlq-endpoint";

beforeAll(async () => {
  await ctx.start();
  reader = await ctx.admin(await ctx.customRole(["wa_agent.read"]));
  writer = await ctx.admin(await ctx.customRole(["wa_agent.read", "wa_agent.write"]));
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

async function seed(): Promise<{ dlqId: string; sourceId: string }> {
  const sourceId = (await ctx.redis.xadd(SOURCE, "*", "data", '{"type":"order_paid"}')) ?? "";
  const dlqId =
    (await ctx.redis.xadd(
      WA_AGENT_DLQ_STREAM,
      "*",
      "stream",
      SOURCE,
      "id",
      sourceId,
      "group",
      "wa-agent-events",
      "errorClass",
      "Error",
      "deliveries",
      "5",
      "at",
      new Date().toISOString(),
      "data",
      '{"type":"order_paid"}',
    )) ?? "";
  return { dlqId, sourceId };
}

const auditRows = (action: string, targetId: string) =>
  ctx.owner.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.targetId, targetId)));

describe("admin wa-agent dead letter", () => {
  it("requires a signed-in admin and the right permission", async () => {
    const { dlqId } = await seed();
    const anonymous = await ctx.harness.call("GET", "/admin/wa-agent/dlq", {});
    expect(anonymous.statusCode).toBe(401);
    const noAccess = await ctx.harness.call("POST", `/admin/wa-agent/dlq/${dlqId}/replay`, {
      jar: reader.jar,
    });
    expect(noAccess.statusCode).toBe(403);
    const noDelete = await ctx.harness.call("DELETE", `/admin/wa-agent/dlq/${dlqId}`, {
      jar: reader.jar,
    });
    expect(noDelete.statusCode).toBe(403);
    expect(await ctx.redis.xrange(WA_AGENT_DLQ_STREAM, dlqId, dlqId)).toHaveLength(1);
  });

  it("lists, replays (audited without payload) and discards", async () => {
    const { dlqId, sourceId } = await seed();
    const list = await ctx.harness.call("GET", "/admin/wa-agent/dlq?limit=200", {
      jar: reader.jar,
    });
    expect(list.statusCode, list.body).toBe(200);
    const page = waAgentDlqListSchema.parse(list.json());
    expect(page.entries.find((entry) => entry.id === dlqId)).toMatchObject({
      stream: SOURCE,
      entryId: sourceId,
      deliveries: 5,
    });

    const before = await ctx.redis.xlen(SOURCE);
    const replay = await ctx.harness.call("POST", `/admin/wa-agent/dlq/${dlqId}/replay`, {
      jar: writer.jar,
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(waAgentDlqReplaySchema.parse(replay.json())).toEqual({ status: "replayed" });
    expect(await ctx.redis.xlen(SOURCE)).toBe(before + 1);
    const rows = await auditRows("wa_agent.dlq.replay", dlqId);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain("order_paid");

    const again = await ctx.harness.call("POST", `/admin/wa-agent/dlq/${dlqId}/replay`, {
      jar: writer.jar,
    });
    expect(again.statusCode).toBe(404);

    const second = await seed();
    const discard = await ctx.harness.call("DELETE", `/admin/wa-agent/dlq/${second.dlqId}`, {
      jar: writer.jar,
    });
    expect(discard.statusCode, discard.body).toBe(204);
    expect(await ctx.redis.xrange(WA_AGENT_DLQ_STREAM, second.dlqId, second.dlqId)).toHaveLength(0);
    expect(await auditRows("wa_agent.dlq.discard", second.dlqId)).toHaveLength(1);
  });

  it("rejects a malformed entry id", async () => {
    const res = await ctx.harness.call("DELETE", "/admin/wa-agent/dlq/not-an-id", {
      jar: writer.jar,
    });
    expect(res.statusCode).toBe(400);
  });
});
