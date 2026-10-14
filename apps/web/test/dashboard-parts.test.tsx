// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { t } from "@wasfa/shared/i18n";
import { describe, expect, it } from "vitest";

import { VerificationBanner } from "../src/components/dashboard/verification-banner";
import { formatDate, formatRelative } from "../src/lib/dates";
import { label } from "../src/lib/labels";

describe("VerificationBanner", () => {
  it("offers the way out for each missing proof: resend for the email, a link for the phone", () => {
    render(
      <VerificationBanner
        me={{ email: "sara@example.com", emailVerified: false, phoneVerified: false }}
        nonce={undefined}
      />,
    );
    expect(screen.getByRole("heading", { name: t("dashboard.verify.title") })).toBeTruthy();
    expect(screen.getByRole("button", { name: t("auth.resend.button") })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: t("dashboard.verify.phoneLink") }).getAttribute("href"),
    ).toBe("/account#phone");
  });

  it("does not offer an email resend to a phone-only account", () => {
    render(
      <VerificationBanner
        me={{ email: null, emailVerified: false, phoneVerified: false }}
        nonce={undefined}
      />,
    );
    expect(screen.queryByRole("button", { name: t("auth.resend.button") })).toBeNull();
    expect(screen.getByRole("link", { name: t("dashboard.verify.phoneLink") })).toBeTruthy();
  });
});

describe("dates", () => {
  const now = new Date("2026-10-11T12:00:00.000Z");

  it("formats dates in Gregorian with Western digits", () => {
    expect(formatDate("2026-10-18T00:00:00.000Z")).toMatch(/18/);
    expect(formatDate("2026-10-18T12:00:00.000Z")).not.toMatch(/[٠-٩]/);
    expect(formatDate("2026-10-18T12:00:00.000Z")).toMatch(/2026/);
  });

  it("says how long ago in the largest fitting unit, with Western digits", () => {
    expect(formatRelative("2026-10-11T11:59:40.000Z", now)).toBe(formatRelative(now, now));
    expect(formatRelative("2026-10-11T09:00:00.000Z", now)).toMatch(/3/);
    expect(formatRelative("2026-10-08T12:00:00.000Z", now)).toMatch(/3/);
    expect(formatRelative("2026-10-08T12:00:00.000Z", now)).not.toMatch(/[٠-٩]/);
  });
});

describe("label", () => {
  it("translates known codes and falls back to the code itself", () => {
    expect(label("country", "EG")).toBe(t("country.EG"));
    expect(label("profession", "pharmacist")).toBe(t("profession.pharmacist"));
    expect(label("country", "ZZ")).toBe("ZZ");
  });
});
