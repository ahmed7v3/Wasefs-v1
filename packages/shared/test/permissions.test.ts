import { describe, expect, it } from "vitest";

import { COUNTRY_CODE_PATTERN, E164_PATTERN, ONBOARDING_STEPS } from "../src/identity.js";
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  PERMISSION_PATTERN,
  ROLE_KEY_PATTERN,
  SYSTEM_ROLE_KEYS,
  isPermission,
} from "../src/permissions.js";

describe("permission catalog", () => {
  it("has well-formed keys, both labels and a known group for every permission", () => {
    expect(PERMISSION_KEYS.length).toBeGreaterThan(0);
    for (const key of PERMISSION_KEYS) {
      expect(key).toMatch(PERMISSION_PATTERN);
      const info = PERMISSIONS[key];
      expect(info.label.ar.trim()).not.toBe("");
      expect(info.label.en.trim()).not.toBe("");
      expect(PERMISSION_GROUPS[info.group]).toBeDefined();
    }
  });

  it("starts every key with its group name, so the role editor can group by prefix too", () => {
    for (const key of PERMISSION_KEYS) {
      expect(key.startsWith(`${PERMISSIONS[key].group}.`)).toBe(true);
    }
  });

  it("has no group without permissions", () => {
    const used = new Set(PERMISSION_KEYS.map((key) => PERMISSIONS[key].group));
    expect([...used].sort()).toEqual(Object.keys(PERMISSION_GROUPS).sort());
  });

  it("recognizes only catalog entries, not inherited object keys", () => {
    expect(isPermission("users.read")).toBe(true);
    expect(isPermission("users.delete")).toBe(false);
    expect(isPermission("toString")).toBe(false);
    expect(isPermission(42)).toBe(false);
  });

  it("defines the system roles with valid keys", () => {
    expect(SYSTEM_ROLE_KEYS).toContain("super_admin");
    for (const key of SYSTEM_ROLE_KEYS) {
      expect(key).toMatch(ROLE_KEY_PATTERN);
    }
  });
});

describe("identity patterns", () => {
  it("accepts E.164 numbers and rejects local formats", () => {
    expect(E164_PATTERN.test("+201001234567")).toBe(true);
    expect(E164_PATTERN.test("+966512345678")).toBe(true);
    expect(E164_PATTERN.test("01001234567")).toBe(false);
    expect(E164_PATTERN.test("+0201001234567")).toBe(false);
    expect(E164_PATTERN.test("+20 100 123 4567")).toBe(false);
  });

  it("accepts upper-case ISO country codes only", () => {
    expect(COUNTRY_CODE_PATTERN.test("EG")).toBe(true);
    expect(COUNTRY_CODE_PATTERN.test("eg")).toBe(false);
    expect(COUNTRY_CODE_PATTERN.test("EGY")).toBe(false);
  });

  it("ends the onboarding steps at `done` without duplicates", () => {
    expect(ONBOARDING_STEPS.at(-1)).toBe("done");
    expect(new Set(ONBOARDING_STEPS).size).toBe(ONBOARDING_STEPS.length);
  });
});
