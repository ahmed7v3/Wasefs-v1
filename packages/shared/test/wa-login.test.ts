import { describe, expect, it } from "vitest";

import { t } from "../src/i18n/index.js";
import { replyOutcomeSchema, replyText } from "../src/schemas/phone.js";
import {
  cleanPushName,
  displayLoginToken,
  formatLoginToken,
  parseLoginToken,
  waLoginEntrySchema,
} from "../src/schemas/wa-login.js";

describe("parseLoginToken", () => {
  it("finds the token inside the pre-filled message, in either language", () => {
    const token = formatLoginToken("ABCD1234");
    expect(parseLoginToken(t("auth.whatsapp.waMessage", { token }, "ar"))).toBe("ABCD1234");
    expect(parseLoginToken(t("auth.whatsapp.waMessage", { token }, "en"))).toBe("ABCD1234");
  });

  it("accepts lower case and Arabic digits, and text around it", () => {
    expect(parseLoginToken("wasfa-abcd-1234")).toBe("ABCD1234");
    expect(parseLoginToken("رمز WASFA-٧٧٧٧-٠٠٠٠ شكرا")).toBe("77770000");
  });

  it("rejects characters outside the Crockford alphabet (I, L, O, U) and short tokens", () => {
    expect(parseLoginToken("WASFA-ABCI-1234")).toBeNull();
    expect(parseLoginToken("WASFA-ABCL-1234")).toBeNull();
    expect(parseLoginToken("WASFA-ABCO-1234")).toBeNull();
    expect(parseLoginToken("WASFA-ABCU-1234")).toBeNull();
    expect(parseLoginToken("WASFA-ABC-1234")).toBeNull();
    expect(parseLoginToken("482913")).toBeNull();
    expect(parseLoginToken("")).toBeNull();
  });

  it("formats for the message and for the page", () => {
    expect(formatLoginToken("ABCD1234")).toBe("WASFA-ABCD-1234");
    expect(displayLoginToken("ABCD1234")).toBe("ABCD-1234");
  });
});

describe("login reply sentences", () => {
  it.each(["login_ok", "login_refused", "login_expired", "logout_ok"] as const)(
    "%s is short and has no link, in both languages",
    (outcome) => {
      expect(replyOutcomeSchema.options).toContain(outcome);
      const key = {
        login_ok: "phone.reply.loginOk",
        login_refused: "phone.reply.loginRefused",
        login_expired: "phone.reply.loginExpired",
        logout_ok: "phone.reply.logoutOk",
      }[outcome] as "phone.reply.loginOk";
      for (const text of [replyText(outcome), t(key, undefined, "en")]) {
        expect(text.length).toBeGreaterThan(0);
        expect(text.length).toBeLessThanOrEqual(60);
        expect(text).not.toMatch(/https?:|www\.|@/i);
      }
    },
  );
});

describe("waLoginEntrySchema", () => {
  const base = { id: "A1", phone: "+201012345678", jid: "x@y", receivedAt: 1 };

  it("accepts a login claim and a logout command", () => {
    expect(
      waLoginEntrySchema.safeParse({ kind: "login", ...base, token: "ABCD1234" }).success,
    ).toBe(true);
    expect(waLoginEntrySchema.safeParse({ kind: "logout", ...base }).success).toBe(true);
  });

  it("rejects a bad token or phone", () => {
    expect(
      waLoginEntrySchema.safeParse({ kind: "login", ...base, token: "ABCI1234" }).success,
    ).toBe(false);
    expect(
      waLoginEntrySchema.safeParse({ kind: "logout", ...base, phone: "0101234" }).success,
    ).toBe(false);
  });
});

describe("cleanPushName", () => {
  it("strips control characters and clips to 60", () => {
    expect(cleanPushName("  Ali\u0000‮ Ahmed\n ")).toBe("Ali Ahmed");
    expect(cleanPushName("x".repeat(100))).toHaveLength(60);
    expect(cleanPushName("\u0007 ")).toBeUndefined();
    expect(cleanPushName(null)).toBeUndefined();
  });
});
