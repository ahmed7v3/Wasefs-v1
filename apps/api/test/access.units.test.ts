import { describe, expect, it } from "vitest";

import { sanitizeAuditValue } from "../src/audit/audit-redact.js";
import { requireMembership } from "../src/common/scoped-repo.js";

describe("sanitizeAuditValue", () => {
  it("redacts secret-looking keys wherever they sit", () => {
    const result = sanitizeAuditValue({
      status: "active",
      passwordHash: "$argon2id$x",
      nested: { apiKey: "sk-123", accessToken: "t", deeper: [{ refresh_token: "r", ok: 1 }] },
      "x-authorization": "Bearer abc",
      backupCodes: ["1", "2"],
      sessionId: "s",
    });
    expect(result).toEqual({
      status: "active",
      passwordHash: "[REDACTED]",
      nested: {
        apiKey: "[REDACTED]",
        accessToken: "[REDACTED]",
        deeper: [{ refresh_token: "[REDACTED]", ok: 1 }],
      },
      "x-authorization": "[REDACTED]",
      backupCodes: "[REDACTED]",
      sessionId: "[REDACTED]",
    });
  });

  it("drops contact fields and scrubs addresses inside free text", () => {
    expect(
      sanitizeAuditValue({
        email: "a@b.co",
        phone: "+201012345678",
        ipAddress: "1.2.3.4",
        reason: "asked by ali@example.com, bearer sk-abcdefghijklmnop",
      }),
    ).toEqual({
      email: "[REDACTED]",
      phone: "[REDACTED]",
      ipAddress: "[REDACTED]",
      reason: expect.not.stringContaining("ali@example.com"),
    });
  });

  it("keeps only allowlisted top-level fields", () => {
    expect(sanitizeAuditValue({ status: "x", other: "y" }, { fields: ["status"] })).toEqual({
      status: "x",
    });
  });

  it("bounds depth, array length, string length and total size, and never throws", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 20; i++) {
      const next: Record<string, unknown> = {};
      cursor["n"] = next;
      cursor = next;
    }
    expect(JSON.stringify(sanitizeAuditValue(deep))).toContain("[TRUNCATED]");
    expect(
      (sanitizeAuditValue({ list: Array.from({ length: 500 }, (_, i) => i) }) as { list: number[] })
        .list,
    ).toHaveLength(50);
    expect(
      (sanitizeAuditValue({ text: "x".repeat(5_000) }) as { text: string }).text.length,
    ).toBeLessThan(600);
    expect(sanitizeAuditValue({ huge: Array.from({ length: 50 }, () => "y".repeat(400)) })).toEqual(
      {
        _truncated: true,
      },
    );
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(() => sanitizeAuditValue(circular)).not.toThrow();
    expect(sanitizeAuditValue(undefined)).toBeNull();
    expect(sanitizeAuditValue(new Date(0))).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("requireMembership", () => {
  const memberships = [
    { orgId: "org-1", role: "org_admin" as const },
    { orgId: "org-2", role: "org_member" as const },
  ];

  it("returns the membership, hides organizations the caller is not in, and checks the role", () => {
    expect(requireMembership(memberships, "org-1")).toEqual(memberships[0]);
    expect(() => requireMembership(memberships, "org-9")).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    expect(() => requireMembership(memberships, "org-2", "org_admin")).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(requireMembership(memberships, "org-1", "org_admin").role).toBe("org_admin");
  });
});
