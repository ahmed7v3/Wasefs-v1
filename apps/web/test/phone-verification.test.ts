import { describe, expect, it } from "vitest";

import {
  initialPhase,
  pollPhase,
  startResponseSchema,
  statusResponseSchema,
  unavailableFromReason,
} from "../src/lib/phone-verification";

const NOW = 1_800_000_000_000;
const status = (extra: Record<string, unknown>) =>
  statusResponseSchema.parse({ status: "none", available: true, bridge: "connected", ...extra });

describe("initialPhase", () => {
  it("hides the feature when it is unavailable, with the reason", () => {
    expect(
      initialPhase(status({ available: false, unavailableReason: "bridge_down" }), NOW),
    ).toEqual({ kind: "unavailable", reason: "bridge_down" });
  });

  it("starts at the form when nothing is in progress", () => {
    expect(initialPhase(status({}), NOW)).toEqual({ kind: "form" });
  });

  it("resumes a pending challenge until it expires", () => {
    expect(
      initialPhase(
        status({ status: "pending", phone: "+201012345678", expiresAt: NOW + 5_000 }),
        NOW,
      ),
    ).toMatchObject({ kind: "waiting", details: { expiresAt: NOW + 5_000 } });
    expect(initialPhase(status({ status: "pending", expiresAt: NOW - 1 }), NOW)).toEqual({
      kind: "expired",
    });
  });

  it("reports verified and failed outcomes", () => {
    expect(initialPhase(status({ status: "verified", phone: "+201012345678" }), NOW)).toEqual({
      kind: "verified",
      phone: "+201012345678",
    });
    expect(initialPhase(status({ status: "failed", failureReason: "phone_in_use" }), NOW)).toEqual({
      kind: "failed",
      reason: "phone_in_use",
    });
  });
});

describe("pollPhase", () => {
  const until = NOW + 60_000;

  it("keeps waiting while pending and before the TTL", () => {
    expect(pollPhase(status({ status: "pending", expiresAt: until }), until, NOW)).toBeNull();
  });

  it("stops at the TTL, and when the server forgot the challenge", () => {
    expect(pollPhase(status({ status: "pending" }), until, until)).toEqual({ kind: "expired" });
    expect(pollPhase(status({ status: "none" }), until, NOW)).toEqual({ kind: "expired" });
  });

  it("ends the wait on success, failure and a feature that went down", () => {
    expect(pollPhase(status({ status: "verified" }), until, NOW)?.kind).toBe("verified");
    expect(pollPhase(status({ status: "failed" }), until, NOW)?.kind).toBe("failed");
    expect(pollPhase(status({ available: false }), until, NOW)?.kind).toBe("unavailable");
  });
});

describe("wire schemas and reasons", () => {
  it("only accepts a wa.me link for the WhatsApp button", () => {
    expect(
      startResponseSchema.safeParse({ status: "pending", waLink: "https://evil.example/x" })
        .success,
    ).toBe(false);
    expect(
      startResponseSchema.safeParse({
        status: "pending",
        code: "123456",
        waLink: "https://wa.me/201000000000?text=hi",
        waNumber: "+201000000000",
        expiresAt: "2026-10-10T10:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("reads the start refusal reasons", () => {
    expect(unavailableFromReason("phone_verification_disabled")).toBe("disabled");
    expect(unavailableFromReason("phone_verification_bridge_down")).toBe("bridge_down");
    expect(unavailableFromReason("phone_verification_unavailable")).toBe("unknown");
    expect(unavailableFromReason("turnstile_required")).toBeNull();
    expect(unavailableFromReason(undefined)).toBeNull();
  });
});
