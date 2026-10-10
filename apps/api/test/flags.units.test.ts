import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  bucket,
  evaluateFlag,
  type FlagRow,
  type FlagSubject,
} from "../src/flags/flags.evaluate.js";

const user = randomUUID();
const org = randomUUID();
const subject: FlagSubject = { userId: user, orgIds: [org], plan: null };
const flag = (rules: unknown, enabled = true, key = "feature.x"): FlagRow => ({
  key,
  enabled,
  rules,
});

describe("evaluateFlag", () => {
  it("a disabled flag is off whatever its rules say", () => {
    expect(evaluateFlag(flag({ type: "all" }, false), subject)).toBe(false);
    expect(evaluateFlag(flag({ type: "percentage", percentage: 100 }, false), subject)).toBe(false);
  });

  it("all (and the empty column default) is on for everyone", () => {
    expect(evaluateFlag(flag({ type: "all" }), subject)).toBe(true);
    expect(evaluateFlag(flag({}), subject)).toBe(true);
  });

  it("user matches only the listed user ids", () => {
    expect(evaluateFlag(flag({ type: "user", userIds: [randomUUID(), user] }), subject)).toBe(true);
    expect(evaluateFlag(flag({ type: "user", userIds: [randomUUID()] }), subject)).toBe(false);
  });

  it("org matches when any of the caller's organizations is listed", () => {
    expect(evaluateFlag(flag({ type: "org", orgIds: [randomUUID(), org] }), subject)).toBe(true);
    expect(evaluateFlag(flag({ type: "org", orgIds: [randomUUID()] }), subject)).toBe(false);
    expect(evaluateFlag(flag({ type: "org", orgIds: [org] }), { ...subject, orgIds: [] })).toBe(
      false,
    );
  });

  it("plan is off while plans do not exist, and matches once a plan is known", () => {
    expect(evaluateFlag(flag({ type: "plan", plans: ["pro"] }), subject)).toBe(false);
    expect(evaluateFlag(flag({ type: "plan", plans: ["pro"] }), { ...subject, plan: "pro" })).toBe(
      true,
    );
    expect(evaluateFlag(flag({ type: "plan", plans: ["pro"] }), { ...subject, plan: "free" })).toBe(
      false,
    );
  });

  it("percentage 0 is nobody and 100 is everybody", () => {
    for (let i = 0; i < 200; i += 1) {
      const each = { ...subject, userId: randomUUID() };
      expect(evaluateFlag(flag({ type: "percentage", percentage: 0 }), each)).toBe(false);
      expect(evaluateFlag(flag({ type: "percentage", percentage: 100 }), each)).toBe(true);
    }
  });

  it("a percentage answer is stable for the same user and flag", () => {
    const rule = flag({ type: "percentage", percentage: 50 });
    const first = evaluateFlag(rule, subject);
    for (let i = 0; i < 20; i += 1) expect(evaluateFlag(rule, subject)).toBe(first);
    expect(bucket("feature.x", user)).toBe(bucket("feature.x", user));
    expect(bucket("feature.x", user)).toBeGreaterThanOrEqual(0);
    expect(bucket("feature.x", user)).toBeLessThan(100);
  });

  it("raising a percentage only adds users", () => {
    for (let i = 0; i < 500; i += 1) {
      const each = { ...subject, userId: randomUUID() };
      if (evaluateFlag(flag({ type: "percentage", percentage: 20 }), each)) {
        expect(evaluateFlag(flag({ type: "percentage", percentage: 60 }), each)).toBe(true);
      }
    }
  });

  it("buckets differ between flag keys for the same users", () => {
    const ids = Array.from({ length: 200 }, () => randomUUID());
    const differing = ids.filter((id) => bucket("feature.a", id) !== bucket("feature.b", id));
    // Independent buckets collide 1 time in 100.
    expect(differing.length).toBeGreaterThan(180);
  });

  it("a percentage of 30 turns on about 30 percent of 10 000 random users (within 3 points)", () => {
    const rule = flag({ type: "percentage", percentage: 30 });
    let on = 0;
    for (let i = 0; i < 10_000; i += 1) {
      if (evaluateFlag(rule, { userId: randomUUID(), orgIds: [], plan: null })) on += 1;
    }
    expect(on / 100).toBeGreaterThan(27);
    expect(on / 100).toBeLessThan(33);
  });

  it("unreadable rules turn the flag off instead of throwing", () => {
    for (const rules of [
      null,
      "all",
      { type: "everyone" },
      { type: "user", userIds: [] },
      { type: "user", userIds: ["not-a-uuid"] },
      { type: "percentage", percentage: 101 },
      { type: "percentage", percentage: 12.5 },
      { type: "org" },
    ]) {
      expect(evaluateFlag(flag(rules), subject), JSON.stringify(rules)).toBe(false);
    }
  });
});
