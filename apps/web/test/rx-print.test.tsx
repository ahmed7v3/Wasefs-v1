// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { t } from "@wasfa/shared/i18n";
import { describe, expect, it } from "vitest";

import { RxPrintSheet } from "../src/components/rx/rx-print-sheet";

import type { RxResult } from "@wasfa/shared/schemas/rx";

const result: RxResult = {
  schemaVersion: 1,
  matching: "model",
  detailsStatus: "ready",
  date: "13/12/2025",
  prescriberLegible: true,
  findings: [],
  unreadableRegions: [],
  overview: {
    summary: "أدوية تُستخدم عادةً لاضطرابات هرمونية.",
    likelyConditions: ["قد يُستخدم في ارتفاع البرولاكتين"],
  },
  items: [
    {
      rawText: "Patient Ahmed Dostenix 0100",
      name: "Dostinex",
      matchedDrugId: null,
      matchScore: null,
      activeIngredients: ["cabergoline"],
      strength: "0.5 mg",
      form: "tablet",
      dose: null,
      frequency: "مرة أسبوعيًا",
      duration: null,
      route: null,
      notes: "Ahmed Hassan 0100",
      confidence: 0.92,
      badge: "high",
      verified: "not_needed",
      details: {
        purpose: "يُستخدم عادةً لخفض مستوى البرولاكتين.",
        sideEffects: ["غثيان"],
        precautions: ["راجع الطبيب قبل الاستخدام أثناء الحمل"],
      },
      box_2d: null,
      page: 0,
    },
    {
      rawText: "Predl?",
      name: "Prednisolone",
      matchedDrugId: null,
      matchScore: null,
      activeIngredients: [],
      strength: null,
      form: null,
      dose: null,
      frequency: null,
      duration: null,
      route: null,
      notes: null,
      confidence: 0.6,
      badge: "medium",
      verified: "not_needed",
      box_2d: null,
      page: 0,
    },
  ],
};

describe("RxPrintSheet", () => {
  it("prints the brand, the address, the table, the details, the overview and the disclaimer", () => {
    const { container } = render(
      <RxPrintSheet result={result} siteUrl="https://wasfa.online" reportDate="15 أكتوبر 2026" />,
    );
    const sheet = container.querySelector("[data-rx-print]") as HTMLElement;
    expect(sheet).toBeTruthy();
    expect(within(sheet).getByText(t("brand.name"))).toBeTruthy();
    expect(within(sheet).getAllByText("wasfa.online").length).toBeGreaterThan(0);
    expect(within(sheet).getByRole("heading", { name: t("rx.print.heading") })).toBeTruthy();
    expect(within(sheet).getAllByText("Dostinex").length).toBeGreaterThan(0);
    expect(within(sheet).getByText(result.overview?.summary ?? "")).toBeTruthy();
    expect(within(sheet).getByText(t("rx.print.detailsTitle"))).toBeTruthy();
    expect(sheet.textContent).toContain("يُستخدم عادةً لخفض مستوى البرولاكتين.");
    expect(sheet.textContent).toContain(t("rx.disclaimer"));
    expect(sheet.textContent).toContain(t("rx.print.cta", { url: "wasfa.online" }));
    expect(sheet.textContent).toContain("15 أكتوبر 2026");
  });

  it("marks only the line that needs a look, and never prints names or the raw text of a read line", () => {
    const { container } = render(
      <RxPrintSheet result={result} siteUrl="https://wasfa.online" reportDate="15 أكتوبر 2026" />,
    );
    const text = (container.querySelector("[data-rx-print]") as HTMLElement).textContent ?? "";
    expect(text.split(t("rx.print.review")).length - 1).toBe(1);
    expect(text).not.toContain("Ahmed");
    expect(text).not.toContain("0100");
    expect(text).not.toContain(t("rx.unmatched"));
  });

  it("has no picture of the prescription: at most the logo chip and the QR code", () => {
    const { container } = render(
      <RxPrintSheet result={result} siteUrl="https://wasfa.online" reportDate="x" />,
    );
    for (const image of container.querySelectorAll("img")) {
      expect(image.getAttribute("src") ?? "").toMatch(/^data:image\/svg/);
    }
    expect(screen.queryByAltText(/روشتة/)).toBeNull();
  });
});
