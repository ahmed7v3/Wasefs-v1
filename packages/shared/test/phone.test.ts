import { describe, expect, it } from "vitest";

import {
  inboundMessageSchema,
  normalizeDigits,
  parseVerificationCode,
  replyText,
  verificationMessage,
  waStatus,
} from "../src/schemas/phone.js";

describe("parseVerificationCode", () => {
  it("finds the code in the pre-filled message, in either language", () => {
    expect(parseVerificationCode(verificationMessage("482913"))).toBe("482913");
    expect(parseVerificationCode(verificationMessage("482913", "en"))).toBe("482913");
  });

  it("accepts Arabic-Indic and Persian digits", () => {
    expect(normalizeDigits("٠١٢٣٤٥٦٧٨٩ ۰۱۲")).toBe("0123456789 012");
    expect(parseVerificationCode("الرمز ٤٨٢٩١٣")).toBe("482913");
  });

  it("ignores digit runs that are not a 6-digit code", () => {
    expect(parseVerificationCode("call 01012345678")).toBeNull();
    expect(parseVerificationCode("12345")).toBeNull();
    expect(parseVerificationCode("1234567")).toBeNull();
    expect(parseVerificationCode("hello")).toBeNull();
    expect(parseVerificationCode("")).toBeNull();
  });

  it("takes the first stand-alone code", () => {
    expect(parseVerificationCode("111111 then 222222")).toBe("111111");
  });
});

describe("bridge replies", () => {
  it("has exactly two fixed sentences, neither with a link", () => {
    expect(replyText("verified")).toBe("تم التحقق ✅");
    expect(replyText("invalid")).toBe("الرمز غير صحيح أو منتهي الصلاحية");
  });
});

describe("inboundMessageSchema", () => {
  it("accepts a well-formed entry and rejects a malformed phone or code", () => {
    const entry = { id: "A1", phone: "+201012345678", code: "123456", receivedAt: 1, jid: "x@y" };
    expect(inboundMessageSchema.safeParse(entry).success).toBe(true);
    expect(inboundMessageSchema.safeParse({ ...entry, phone: "01012345678" }).success).toBe(false);
    expect(inboundMessageSchema.safeParse({ ...entry, code: "12345" }).success).toBe(false);
  });
});

describe("waStatus", () => {
  const now = 1_800_000_000_000;
  const beat = (state: string, at: number) => JSON.stringify({ at, state });

  it("reports the bridge state while the heartbeat is fresh", () => {
    expect(waStatus(beat("connected", now - 10_000), now)).toBe("connected");
    expect(waStatus(beat("logged_out", now - 10_000), now)).toBe("logged_out");
  });

  it("calls a silent, missing or malformed heartbeat down", () => {
    expect(waStatus(beat("connected", now - 120_000), now)).toBe("down");
    expect(waStatus(null, now)).toBe("down");
    expect(waStatus("not json", now)).toBe("down");
    expect(waStatus(beat("exploding", now), now)).toBe("down");
  });
});
