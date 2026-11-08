import { randomUUID } from "node:crypto";

import { setConversationAdsOptOut, waConversations } from "@wasfa/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext } from "./support/admin-context.js";

/*
 * «وقف الإعلانات» / «شغل الإعلانات» on the chat row: the flag the WhatsApp ad floor reads. Written
 * for CI (needs Docker); the keyword parsing and the ad logic have their own unit tests.
 */

const ctx = new AdminTestContext();

beforeAll(async () => {
  await ctx.start();
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

async function flagOf(jid: string): Promise<boolean | undefined> {
  const [row] = await ctx.owner.db
    .select({ adsOptOut: waConversations.adsOptOut })
    .from(waConversations)
    .where(eq(waConversations.jid, jid));
  return row?.adsOptOut;
}

describe("wa_conversations.ads_opt_out", () => {
  it("defaults to off and is switched per chat, by jid or by phone", async () => {
    const digits = `2010${String(70_000_000 + Math.floor(Math.random() * 9_000_000))}`;
    const jid = `${digits}@s.whatsapp.net`;
    const lidJid = `${randomUUID().replaceAll("-", "").slice(0, 14)}@lid`;
    await ctx.owner.db.insert(waConversations).values([
      { jid, phone: `+${digits}` },
      { jid: lidJid, phone: null },
    ]);
    expect(await flagOf(jid)).toBe(false);

    expect(await setConversationAdsOptOut(ctx.owner.db, { jid, phone: `+${digits}` }, true)).toBe(
      1,
    );
    expect(await flagOf(jid)).toBe(true);
    // Another chat is untouched, and saying it twice changes nothing more.
    expect(await flagOf(lidJid)).toBe(false);
    expect(await setConversationAdsOptOut(ctx.owner.db, { jid, phone: `+${digits}` }, true)).toBe(
      1,
    );

    expect(await setConversationAdsOptOut(ctx.owner.db, { jid, phone: `+${digits}` }, false)).toBe(
      1,
    );
    expect(await flagOf(jid)).toBe(false);
  });

  it("changes nothing for a person who never talked to the agent", async () => {
    expect(
      await setConversationAdsOptOut(
        ctx.owner.db,
        { jid: "201099999991@s.whatsapp.net", phone: "+201099999991" },
        true,
      ),
    ).toBe(0);
  });
});
