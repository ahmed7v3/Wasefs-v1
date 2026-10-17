import { notificationPrefs, users } from "@wasfa/db";
import { WA_CUSTOMER_OPTOUT_SET } from "@wasfa/shared/customer-messages";
import { notificationPrefsResponseSchema } from "@wasfa/shared/schemas/notification-prefs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SettingsService } from "../src/settings/settings.service.js";

import { AdminTestContext, type Person } from "./support/admin-context.js";

/*
 * `GET` and `PUT /me/notification-prefs`: a customer with a phone verified through our WhatsApp
 * number can switch WhatsApp notifications off (email then) and on again; the bridge's opt-out set
 * follows at once.
 */

const ctx = new AdminTestContext();
let counter = 0;

beforeAll(async () => {
  await ctx.start();
  const settings = ctx.app.get(SettingsService);
  const whatsapp = await settings.get("whatsapp");
  await settings.set(
    "whatsapp",
    { ...whatsapp, customerMessages: { ...whatsapp.customerMessages, enabled: true } },
    { actorId: null },
  );
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

async function withVerifiedPhone(person: Person): Promise<string> {
  const phone = `+2011${String(++counter).padStart(8, "0")}`;
  await ctx.owner.db
    .update(users)
    .set({ phone, phoneVerified: true, phoneVerifiedAt: new Date() })
    .where(eq(users.id, person.userId));
  return phone;
}

const get = (person: Person) =>
  ctx.harness.call("GET", "/me/notification-prefs", { jar: person.jar });
const put = (person: Person, body: Record<string, unknown>) =>
  ctx.harness.call("PUT", "/me/notification-prefs", { jar: person.jar, body });

describe("/me/notification-prefs", () => {
  it("needs a session", async () => {
    expect((await ctx.harness.call("GET", "/me/notification-prefs")).statusCode).toBe(401);
    expect(
      (await ctx.harness.call("PUT", "/me/notification-prefs", { body: { whatsapp: false } }))
        .statusCode,
    ).toBe(401);
  });

  it("offers WhatsApp only with a verified phone", async () => {
    const person = await ctx.harness.signedInUser();
    const res = await get(person);
    expect(res.statusCode, res.body).toBe(200);
    expect(notificationPrefsResponseSchema.parse(res.json()).whatsapp).toEqual({
      available: false,
      enabled: false,
      active: true,
    });
    const refused = await put(person, { whatsapp: true });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ details: { reason: "phone_not_verified" } });
  });

  it("switches WhatsApp off and on, on the account and in the bridge's opt-out set", async () => {
    const person = await ctx.harness.signedInUser();
    const phone = await withVerifiedPhone(person);
    const jid = `${phone.slice(1)}@s.whatsapp.net`;
    expect(notificationPrefsResponseSchema.parse((await get(person)).json()).whatsapp).toEqual({
      available: true,
      enabled: true,
      active: true,
    });

    const off = await put(person, { whatsapp: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(notificationPrefsResponseSchema.parse(off.json()).whatsapp.enabled).toBe(false);
    expect(await ctx.redis.sismember(WA_CUSTOMER_OPTOUT_SET, jid)).toBe(1);
    const [row] = await ctx.owner.db
      .select()
      .from(notificationPrefs)
      .where(eq(notificationPrefs.userId, person.userId));
    expect(row?.whatsappOptedOutVia).toBe("account");

    const on = await put(person, { whatsapp: true });
    expect(notificationPrefsResponseSchema.parse(on.json()).whatsapp.enabled).toBe(true);
    expect(await ctx.redis.sismember(WA_CUSTOMER_OPTOUT_SET, jid)).toBe(0);
  });

  it("rejects a body that is not { whatsapp: boolean }", async () => {
    const person = await ctx.harness.signedInUser();
    await withVerifiedPhone(person);
    expect((await put(person, { whatsapp: "no" })).statusCode).toBe(400);
    expect((await put(person, {})).statusCode).toBe(400);
  });
});
