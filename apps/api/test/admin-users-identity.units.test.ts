import { describe, expect, it } from "vitest";

import { safeAvatarUrl, toAdminUser } from "../src/admin/users/admin-users.service.js";

import type { UserDetailRow } from "../src/admin/users/admin-users.repo.js";

describe("safeAvatarUrl", () => {
  it("keeps https URLs", () => {
    expect(safeAvatarUrl("https://lh3.googleusercontent.com/a/abc=s96-c")).toBe(
      "https://lh3.googleusercontent.com/a/abc=s96-c",
    );
  });

  it("drops everything that is not https", () => {
    for (const bad of [
      "http://example.com/a.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "not a url",
      "",
      null,
      undefined,
    ]) {
      expect(safeAvatarUrl(bad)).toBeNull();
    }
  });
});

describe("toAdminUser", () => {
  const row: UserDetailRow = {
    id: "0198f3a0-0000-7000-8000-000000000001",
    name: "Sara",
    email: "sara@example.com",
    phone: null,
    emailVerified: true,
    phoneVerified: false,
    status: "active",
    accountType: "individual",
    image: "http://insecure.example/a.png",
    twoFactorEnabled: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastLoginAt: null,
    suspendedReason: null,
    deletedAt: null,
    locale: "ar",
  };

  it("maps providers, sanitised image and 2FA", () => {
    const user = toAdminUser(row, ["admin"], ["credential", "google"]);
    expect(user.providers).toEqual(["credential", "google"]);
    expect(user.image).toBeNull();
    expect(user.twoFactorEnabled).toBe(true);
    expect(user.roles).toEqual(["admin"]);
  });
});
