import { randomBytes } from "node:crypto";

import { formatPublishingKey, parsePublishingKey } from "@wasfa/shared/publishing";
import {
  publishingKeyInputSchema,
  rotatePublishingKeySchema,
} from "@wasfa/shared/schemas/admin-publishing-keys";
import { describe, expect, it } from "vitest";

import { sanitizeAuditValue } from "../src/audit/audit-redact.js";
import { auditView } from "../src/publishing/admin-publishing-keys.service.js";
import { compileAllowList, ipAllowed, isValidAllowEntry } from "../src/publishing/publishing-ip.js";
import {
  derivePepper,
  generateKeyId,
  generateSecret,
  hashSecret,
  secretMatchesHash,
  verifyKeySecret,
} from "../src/publishing/publishing-key-crypto.js";
import { publishingKeyPatchSchema } from "../src/publishing/publishing-key-patch.js";
import {
  PUBLISHING_CREATE_ROUTES,
  PUBLISHING_PUBLISH_ROUTES,
} from "../src/publishing/publishing-routes.js";

import type { PublishingApiKeyRow } from "@wasfa/db";

const PEPPER = derivePepper(randomBytes(32));

describe("publishing key generation", () => {
  it("round-trips through format and parse with unambiguous alphanumerics", () => {
    const keyId = generateKeyId();
    const secret = generateSecret();
    expect(keyId).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(secret).toMatch(/^[A-Za-z0-9]{48}$/);
    expect(`${keyId}${secret}`).not.toMatch(/[0OIl1]/);
    const raw = formatPublishingKey("live", keyId, secret);
    expect(parsePublishingKey(raw)).toEqual({ environment: "live", keyId, secret });
    expect(parsePublishingKey(`${raw}x_`)).toBeNull();
    expect(parsePublishingKey("wsk_live_short_secret")).toBeNull();
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateSecret()));
    expect(seen.size).toBe(200);
  });
});

describe("publishing key secrets", () => {
  it("hashes deterministically per pepper and differently across peppers", () => {
    const secret = generateSecret();
    expect(hashSecret(PEPPER, secret)).toBe(hashSecret(PEPPER, secret));
    expect(hashSecret(PEPPER, secret)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret(derivePepper(randomBytes(32)), secret)).not.toBe(hashSecret(PEPPER, secret));
    expect(hashSecret(PEPPER, secret)).not.toContain(secret);
  });

  it("compares in constant time form: right, wrong and malformed hashes", () => {
    const secret = generateSecret();
    const hash = hashSecret(PEPPER, secret);
    expect(secretMatchesHash(PEPPER, secret, hash)).toBe(true);
    expect(secretMatchesHash(PEPPER, `${secret}x`, hash)).toBe(false);
    expect(secretMatchesHash(PEPPER, secret, "abcd")).toBe(false);
    expect(secretMatchesHash(PEPPER, secret, "")).toBe(false);
  });

  it("accepts the previous secret only while the rotation grace runs", () => {
    const oldSecret = generateSecret();
    const newSecret = generateSecret();
    const now = new Date("2026-11-09T10:00:00Z");
    const state = (until: Date | null) => ({
      secretHash: hashSecret(PEPPER, newSecret),
      prevSecretHash: hashSecret(PEPPER, oldSecret),
      prevValidUntil: until,
    });
    const future = new Date(now.getTime() + 3_600_000);
    const past = new Date(now.getTime() - 1);
    expect(verifyKeySecret(PEPPER, newSecret, state(future), now)).toBe(true);
    expect(verifyKeySecret(PEPPER, oldSecret, state(future), now)).toBe(true);
    expect(verifyKeySecret(PEPPER, oldSecret, state(past), now)).toBe(false);
    expect(verifyKeySecret(PEPPER, oldSecret, state(null), now)).toBe(false);
    expect(verifyKeySecret(PEPPER, newSecret, state(past), now)).toBe(true);
    expect(
      verifyKeySecret(
        PEPPER,
        oldSecret,
        { secretHash: hashSecret(PEPPER, newSecret), prevSecretHash: null, prevValidUntil: future },
        now,
      ),
    ).toBe(false);
  });
});

describe("ip allow-list", () => {
  it("allows everything when the list is empty", () => {
    expect(ipAllowed("203.0.113.9", [])).toBe(true);
  });

  it("matches single IPv4 addresses and CIDR blocks", () => {
    const list = ["203.0.113.9", "198.51.100.0/24"];
    expect(ipAllowed("203.0.113.9", list)).toBe(true);
    expect(ipAllowed("203.0.113.10", list)).toBe(false);
    expect(ipAllowed("198.51.100.255", list)).toBe(true);
    expect(ipAllowed("198.51.101.0", list)).toBe(false);
    expect(ipAllowed("10.0.0.1", ["0.0.0.0/0"])).toBe(true);
    expect(ipAllowed("10.0.0.1", ["10.0.0.1/32"])).toBe(true);
    expect(ipAllowed("10.0.0.2", ["10.0.0.1/32"])).toBe(false);
  });

  it("matches IPv6 addresses and blocks, and IPv4-mapped clients against IPv4 entries", () => {
    expect(ipAllowed("2001:db8::1", ["2001:db8::/32"])).toBe(true);
    expect(ipAllowed("2001:db9::1", ["2001:db8::/32"])).toBe(false);
    expect(ipAllowed("2001:db8::1", ["2001:db8::1"])).toBe(true);
    expect(ipAllowed("::ffff:203.0.113.9", ["203.0.113.9"])).toBe(true);
    expect(ipAllowed("203.0.113.9", ["2001:db8::/32"])).toBe(false);
  });

  it("denies garbage client addresses and ignores garbage entries", () => {
    expect(ipAllowed("not-an-ip", ["203.0.113.9"])).toBe(false);
    expect(ipAllowed("203.0.113.9", ["nonsense"])).toBe(false);
    expect(compileAllowList(["nonsense", "1.2.3.4/99"]).check("1.2.3.4", "ipv4")).toBe(false);
  });

  it("validates entries", () => {
    expect(isValidAllowEntry("10.0.0.0/8")).toBe(true);
    expect(isValidAllowEntry("::1")).toBe(true);
    expect(isValidAllowEntry("2001:db8::/129")).toBe(false);
    expect(isValidAllowEntry("10.0.0.0/33")).toBe(false);
    expect(isValidAllowEntry("10.0.0.0/")).toBe(false);
    expect(isValidAllowEntry("example.com")).toBe(false);
  });
});

describe("admin key schemas", () => {
  const valid = { name: "n8n series", scopes: ["content:write"] };

  it("fills the documented defaults", () => {
    const parsed = publishingKeyInputSchema.parse(valid);
    expect(parsed).toMatchObject({
      environment: "live",
      canPublish: false,
      requestsPerMinute: 60,
      expiresInDays: 365,
      allowedTypes: [],
    });
  });

  it("rejects empty or unknown scopes and out-of-range expiry", () => {
    expect(publishingKeyInputSchema.safeParse({ ...valid, scopes: [] }).success).toBe(false);
    expect(publishingKeyInputSchema.safeParse({ ...valid, scopes: ["admin"] }).success).toBe(false);
    expect(publishingKeyInputSchema.safeParse({ ...valid, expiresInDays: 0 }).success).toBe(false);
    expect(publishingKeyInputSchema.safeParse({ ...valid, expiresInDays: 731 }).success).toBe(
      false,
    );
    expect(publishingKeyInputSchema.safeParse({ ...valid, expiresInDays: 730 }).success).toBe(true);
  });

  it("bounds the rotation grace to 0 to 168 hours", () => {
    expect(rotatePublishingKeySchema.parse({}).graceHours).toBe(24);
    expect(rotatePublishingKeySchema.safeParse({ graceHours: 169 }).success).toBe(false);
    expect(rotatePublishingKeySchema.safeParse({ graceHours: -1 }).success).toBe(false);
  });

  it("builds a patch without defaults, strict, and never empty", () => {
    expect(publishingKeyPatchSchema.parse({ name: "renamed" })).toEqual({ name: "renamed" });
    expect(publishingKeyPatchSchema.safeParse({}).success).toBe(false);
    expect(publishingKeyPatchSchema.safeParse({ scopes: [] }).success).toBe(false);
    expect(publishingKeyPatchSchema.safeParse({ environment: "test" }).success).toBe(false);
    expect(publishingKeyPatchSchema.safeParse({ ownerUserId: "x" }).success).toBe(false);
    expect(publishingKeyPatchSchema.safeParse({ secret: "x" }).success).toBe(false);
  });
});

describe("audit of key changes", () => {
  const row = {
    id: "00000000-0000-7000-8000-000000000001",
    keyId: "AbCdEfGhJkMn",
    environment: "live",
    secretHash: "a".repeat(64),
    prevSecretHash: "b".repeat(64),
    prevValidUntil: null,
    last4: "wxyz",
    name: "n8n",
    ownerUserId: "00000000-0000-7000-8000-000000000002",
    scopes: ["content:write"],
    canPublish: false,
    allowedTypes: [],
    allowedCategorySlugs: [],
    defaultAuthorId: null,
    defaultFeaturedMediaId: null,
    dailyPublishCap: null,
    requestsPerMinute: 60,
    ipAllowList: ["203.0.113.9"],
    createdAt: new Date(),
    expiresAt: new Date("2027-11-09T00:00:00Z"),
    lastUsedAt: null,
    revokedAt: null,
  } satisfies PublishingApiKeyRow;

  it("carries no secret, hash, key id or last4", () => {
    const text = JSON.stringify(auditView(row));
    for (const forbidden of [row.secretHash, row.prevSecretHash, row.keyId, row.last4]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("redacts a stray secret field in any audit payload", () => {
    const cleaned = sanitizeAuditValue({ secret: "wsk_live_x", name: "n8n" }) as Record<
      string,
      unknown
    >;
    expect(cleaned.secret).toBe("[REDACTED]");
    expect(cleaned.name).toBe("n8n");
  });
});

describe("usage route constants", () => {
  it("count creates and publishes by method and template", () => {
    expect(
      PUBLISHING_CREATE_ROUTES.every((entry) => entry.route.startsWith("/publishing/v1/")),
    ).toBe(true);
    expect(PUBLISHING_PUBLISH_ROUTES.map((entry) => entry.route)).toEqual([
      "/publishing/v1/articles/:id/publish",
      "/publishing/v1/articles/:id/schedule",
    ]);
  });
});
