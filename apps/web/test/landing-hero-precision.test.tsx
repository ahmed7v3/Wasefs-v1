// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { IsoScene } from "../src/components/marketing/iso-scene";
import { LandingHero } from "../src/components/marketing/landing-hero";
import { PrecisionWalkthrough } from "../src/components/marketing/precision-walkthrough";
import { landing } from "../src/content/landing";
import { landingEn } from "../src/content/landing.en";

/** SVG budget of BRAND-AND-HOMEPAGE §4. */
const SVG_BUDGET_BYTES = 25 * 1024;

describe("IsoScene", () => {
  it("is one image with the descriptive alt text, per language", () => {
    const { rerender } = render(<IsoScene />);
    expect(screen.getByRole("img", { name: landing.visual.alt })).toBeTruthy();
    rerender(<IsoScene locale="en" />);
    expect(screen.getByRole("img", { name: landingEn.visual.alt })).toBeTruthy();
  });

  it("draws two confident rows, one flagged row and the sample chip as real text", () => {
    const { container } = render(<IsoScene />);
    const text = container.textContent ?? "";
    expect(text).toContain(landing.visual.sampleBadge);
    expect(text.split(landing.visual.review).length - 1).toBe(1);
    expect(text.split(landing.visual.confidenceHigh).length - 1).toBe(2);
  });

  it("switches the illustration text to English", () => {
    const { container } = render(<IsoScene locale="en" />);
    expect(container.textContent).toContain(landingEn.visual.sampleBadge);
    expect(container.textContent).not.toContain(landing.visual.sampleBadge);
  });

  it("stays under the inline SVG budget and reserves its box", () => {
    for (const locale of ["ar", "en"] as const) {
      const html = renderToStaticMarkup(<IsoScene locale={locale} />);
      const svgs = html.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
      expect(svgs.length).toBeGreaterThan(0);
      for (const svg of svgs) expect(Buffer.byteLength(svg)).toBeLessThan(SVG_BUDGET_BYTES);
      // Decorative icons: at most three `<use>` mascots.
      expect(html.match(/<use /g)?.length ?? 0).toBeLessThanOrEqual(3);
    }
  });
});

describe("LandingHero", () => {
  it("renders the pill, a plain two-line H1 and the actions in reading order", () => {
    const { container } = render(<LandingHero />);
    const h1 = container.querySelector("h1");
    expect(h1?.querySelectorAll("span").length).toBe(2);
    expect(h1?.textContent).toBe(landing.hero.titleLines.join(""));
    const order = [landing.hero.pill, landing.hero.titleLines.join(""), landing.hero.lead].map(
      (part) => container.textContent?.indexOf(part) ?? -1,
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((position) => position >= 0)).toBe(true);
  });
});

describe("PrecisionWalkthrough", () => {
  it("renders the four steps as server-side text with the link to the reader page", () => {
    render(<PrecisionWalkthrough />);
    expect(screen.getByRole("heading", { level: 2, name: landing.precision.title })).toBeTruthy();
    for (const step of landing.precision.steps) {
      expect(screen.getByRole("heading", { level: 3, name: step.title })).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: landing.precision.link }).getAttribute("href")).toBe(
      "/features/prescription-reader",
    );
  });

  it("links to the English reader page under /en", () => {
    render(<PrecisionWalkthrough locale="en" />);
    expect(screen.getByRole("link", { name: landingEn.precision.link }).getAttribute("href")).toBe(
      "/en/features/prescription-reader",
    );
  });

  it("hides the proof strip while nothing is published", () => {
    const { container } = render(
      <PrecisionWalkthrough proof={{ avgAnalysisSeconds: null, accuracyPercent: null }} />,
    );
    expect(container.querySelector("dl")).toBeNull();
  });

  it("shows only the published figures, in Western digits by default", () => {
    const { container } = render(
      <PrecisionWalkthrough proof={{ avgAnalysisSeconds: 12.5, accuracyPercent: null }} />,
    );
    const figures = container.querySelectorAll("dl > div");
    expect(figures.length).toBe(1);
    expect(figures[0]?.textContent).toContain(landing.precision.proof.avgLabel);
    expect(figures[0]?.textContent).toContain("12.5");
  });

  it("uses Arabic-Indic digits when the admin turns Western digits off", () => {
    const { container } = render(
      <PrecisionWalkthrough
        westernDigits={false}
        proof={{ avgAnalysisSeconds: 12.5, accuracyPercent: 94 }}
      />,
    );
    expect(container.querySelectorAll("dl > div").length).toBe(2);
    expect(container.querySelector("dl")?.textContent).toMatch(/[٠-٩]/);
    expect(container.querySelector("dl")?.textContent).not.toMatch(/[0-9]/);
  });

  it("keeps English digits Western whatever the Arabic setting says", () => {
    const { container } = render(
      <PrecisionWalkthrough
        locale="en"
        westernDigits={false}
        proof={{ avgAnalysisSeconds: 8, accuracyPercent: null }}
      />,
    );
    expect(container.querySelector("dl")?.textContent).toContain("8");
  });
});
