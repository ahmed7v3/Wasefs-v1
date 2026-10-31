import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  isActive,
  nextSetLabel,
  waAgentProfileSchema,
  waSessionStateSchema,
} from "../src/wa-agent/session.js";

describe("nextSetLabel", () => {
  it("walks A to Z, then AA, AB", () => {
    expect(nextSetLabel(null)).toBe("A");
    expect(nextSetLabel("A")).toBe("B");
    expect(nextSetLabel("Y")).toBe("Z");
    expect(nextSetLabel("Z")).toBe("AA");
    expect(nextSetLabel("AA")).toBe("AB");
    expect(nextSetLabel("AZ")).toBe("BA");
    expect(nextSetLabel("ZZ")).toBe("AAA");
  });

  it("is strictly increasing by (length, alphabet) and never repeats", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_500 }), (steps) => {
        const seen = new Set<string>();
        let label: string | null = null;
        let previous = "";
        for (let step = 0; step < steps; step += 1) {
          label = nextSetLabel(label);
          expect(seen.has(label)).toBe(false);
          seen.add(label);
          const later =
            label.length > previous.length ||
            (label.length === previous.length && label > previous);
          expect(later).toBe(true);
          previous = label;
        }
      }),
    );
  });
});

describe("isActive", () => {
  const now = new Date("2026-10-31T10:00:00.000Z");
  it("is false when absent or expired, true before until", () => {
    expect(isActive(undefined, now)).toBe(false);
    expect(isActive({ until: "2026-10-31T09:59:59.000Z" }, now)).toBe(false);
    expect(isActive({ until: "2026-10-31T10:00:00.000Z" }, now)).toBe(false);
    expect(isActive({ until: "2026-10-31T10:10:00.000Z" }, now)).toBe(true);
    expect(isActive({ until: "garbage" }, now)).toBe(false);
  });
});

describe("session schemas", () => {
  it("accepts a partial profile and rejects an unknown language or a long name", () => {
    expect(waAgentProfileSchema.parse({})).toEqual({});
    expect(waAgentProfileSchema.parse({ lang: "ar", voice: "off", preferredName: "منى" })).toEqual({
      lang: "ar",
      voice: "off",
      preferredName: "منى",
    });
    expect(waAgentProfileSchema.safeParse({ lang: "fr" }).success).toBe(false);
    expect(waAgentProfileSchema.safeParse({ preferredName: "x".repeat(41) }).success).toBe(false);
  });

  it("requires an ISO time in every state entry", () => {
    expect(
      waSessionStateSchema.parse({ menu: { until: "2026-10-31T10:10:00.000Z" } }),
    ).toBeTruthy();
    expect(waSessionStateSchema.safeParse({ menu: { until: "soon" } }).success).toBe(false);
  });
});
