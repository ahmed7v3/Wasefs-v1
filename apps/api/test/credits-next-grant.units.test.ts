import { describe, expect, it } from "vitest";

import { nextGrantFor } from "../src/credits/credits.service.js";

/* `GET /me/credits` `nextGrantAt`: the calendar month for everyone, the anniversary for subscribers. */

const at = (iso: string) => new Date(iso);

describe("nextGrantFor", () => {
  it("is the first of next month without a subscription or on a trial", () => {
    const now = at("2026-10-17T08:00:00.000Z");
    expect(nextGrantFor(now, undefined).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    const trial = {
      start: at("2026-10-10T00:00:00.000Z"),
      end: at("2026-10-24T00:00:00.000Z"),
      source: "trial",
    };
    expect(nextGrantFor(now, trial).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("is the next anniversary inside a paid period", () => {
    const period = {
      start: at("2026-01-31T09:00:00.000Z"),
      end: at("2027-01-31T09:00:00.000Z"),
      source: "paid",
    };
    expect(nextGrantFor(at("2026-02-10T00:00:00.000Z"), period).toISOString()).toBe(
      "2026-02-28T09:00:00.000Z",
    );
  });

  it("is the period end after the last anniversary, when the calendar grant resumes", () => {
    const period = {
      start: at("2026-10-01T00:00:00.000Z"),
      end: at("2026-11-01T00:00:00.000Z"),
      source: "paid",
    };
    expect(nextGrantFor(at("2026-10-17T00:00:00.000Z"), period).toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
  });
});
