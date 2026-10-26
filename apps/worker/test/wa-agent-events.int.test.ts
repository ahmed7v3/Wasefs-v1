import { createDb, notificationPrefs, siteSettings, users, waConversations } from "@wasfa/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { agentShouldFollowUp, type PaymentFollowUp } from "../src/notifications/wa-agent-events.js";

import { startPostgres, type TestPostgres } from "./support/postgres.js";

/*
 * When the WhatsApp agent follows up a payment decision: only if it is on, the customer wrote to it
 * in the last 24 hours, they have not stopped WhatsApp messages, and the customer-message path would
 * NOT already tell them on WhatsApp (nobody is messaged twice). Real Postgres as `wasfa_api`.
 */

let postgres: TestPostgres;
let owner: ReturnType<typeof createDb>;
let worker: ReturnType<typeof createDb>;
let counter = 0;
const NOW = new Date("2026-10-26T10:00:00.000Z");
const HOUR = 3_600_000;

beforeAll(async () => {
  postgres = await startPostgres();
  owner = createDb({ url: postgres.ownerUrl, max: 2 });
  worker = createDb({ url: postgres.apiUrl, max: 2 });
}, 180_000);

afterAll(async () => {
  await Promise.all([owner.close(), worker.close()]);
  await postgres.stop();
});

async function setSettings(agentEnabled: boolean, customerMessagesEnabled: boolean) {
  await owner.db.delete(siteSettings);
  await owner.db.insert(siteSettings).values([
    { key: "waAgent", value: { enabled: agentEnabled } },
    { key: "whatsapp", value: { customerMessages: { enabled: customerMessagesEnabled } } },
  ]);
}

/** A customer with a verified number and (optionally) a chat whose last message is `hoursAgo` old. */
async function customer(options: { hoursAgo?: number; optedOut?: boolean } = {}) {
  counter += 1;
  const [row] = await owner.db
    .insert(users)
    .values({
      name: "Customer",
      email: `agent-events-${String(counter)}@example.com`,
      phone: `+2010${String(50_000_000 + counter * 13)}`,
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
      locale: "ar",
    })
    .returning({ id: users.id, phone: users.phone });
  if (!row) throw new Error("user insert failed");
  if (options.hoursAgo !== undefined) {
    await owner.db.insert(waConversations).values({
      jid: `${String(counter)}@s.whatsapp.net`,
      phone: row.phone,
      userId: row.id,
      lastInboundAt: new Date(NOW.getTime() - options.hoursAgo * HOUR),
    });
  }
  if (options.optedOut) {
    await owner.db
      .insert(notificationPrefs)
      .values({ userId: row.id, whatsappOptedOutAt: new Date() });
  }
  return row.id;
}

const event = (userId: string): PaymentFollowUp => ({
  type: "order_paid",
  userId,
  orderId: "018f0000-0000-7000-8000-0000000000b1",
});

describe("agentShouldFollowUp", () => {
  it("follows up a customer who wrote today when customer messages would not reach them", async () => {
    await setSettings(true, false);
    const userId = await customer({ hoursAgo: 2 });
    await expect(agentShouldFollowUp(worker.db, event(userId), NOW)).resolves.toBe(true);
  });

  it("stays out when the customer-message path will send the WhatsApp message itself", async () => {
    await setSettings(true, true);
    const userId = await customer({ hoursAgo: 2 });
    await expect(agentShouldFollowUp(worker.db, event(userId), NOW)).resolves.toBe(false);
  });

  it("stays out after 24 hours of silence, without a chat, when the agent is off, or after STOP", async () => {
    await setSettings(true, false);
    const silent = await customer({ hoursAgo: 25 });
    await expect(agentShouldFollowUp(worker.db, event(silent), NOW)).resolves.toBe(false);
    const noChat = await customer();
    await expect(agentShouldFollowUp(worker.db, event(noChat), NOW)).resolves.toBe(false);
    const stopped = await customer({ hoursAgo: 1, optedOut: true });
    await expect(agentShouldFollowUp(worker.db, event(stopped), NOW)).resolves.toBe(false);

    await setSettings(false, false);
    const recent = await customer({ hoursAgo: 1 });
    await expect(agentShouldFollowUp(worker.db, event(recent), NOW)).resolves.toBe(false);
  });
});
