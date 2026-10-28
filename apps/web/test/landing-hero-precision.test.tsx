// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FinalCta } from "../src/components/marketing/final-cta";
import { HeroScene } from "../src/components/marketing/hero-scene";
import { HowItWorks } from "../src/components/marketing/how-it-works";
import { LandingHero } from "../src/components/marketing/landing-hero";
import { PrecisionWalkthrough } from "../src/components/marketing/precision-walkthrough";
import { WhatsAppSection } from "../src/components/marketing/whatsapp-section";
import { landing } from "../src/content/landing";
import { landingEn } from "../src/content/landing.en";
import { whatsappUrl } from "../src/lib/contact-links";

/** SVG budget of BRAND-AND-HOMEPAGE §4. */
const SVG_BUDGET_BYTES = 25 * 1024;
const WA = "https://wa.me/201012345678?text=%D9%85";

describe("whatsappUrl", () => {
  it("builds the wa.me link with an encoded greeting, and is null without a number", () => {
    expect(whatsappUrl("+20 101 234 5678", landing.hero.whatsappGreeting)).toBe(
      `https://wa.me/201012345678?text=${encodeURIComponent(landing.hero.whatsappGreeting)}`,
    );
    expect(whatsappUrl("+201012345678")).toBe("https://wa.me/201012345678");
    expect(whatsappUrl(null, "hi")).toBeNull();
    expect(whatsappUrl("", "hi")).toBeNull();
  });
});

describe("HeroScene", () => {
  it("is one image with the descriptive alt text, per language", () => {
    const { rerender } = render(<HeroScene />);
    expect(screen.getByRole("img", { name: landing.scene.alt })).toBeTruthy();
    rerender(<HeroScene locale="en" />);
    expect(screen.getByRole("img", { name: landingEn.scene.alt })).toBeTruthy();
  });

  it("draws both medicines with their schedule chips, a PDF and a voice note as real text", () => {
    const { container } = render(<HeroScene />);
    const text = container.textContent ?? "";
    for (const item of landing.scene.items) {
      expect(text).toContain(item.name);
      for (const time of item.times) expect(text).toContain(time.label);
    }
    expect(text).toContain(landing.scene.pdfName);
    expect(text).toContain(landing.scene.voiceLength);
    expect(text).toContain(landing.scene.sampleBadge);
  });

  it("stays under the inline SVG budget and under 25 KB of markup", () => {
    for (const locale of ["ar", "en"] as const) {
      const html = renderToStaticMarkup(<HeroScene locale={locale} />);
      expect(Buffer.byteLength(html)).toBeLessThan(SVG_BUDGET_BYTES);
      const svgs = html.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
      expect(svgs.length).toBeGreaterThan(0);
      for (const svg of svgs) expect(Buffer.byteLength(svg)).toBeLessThan(SVG_BUDGET_BYTES);
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

  it("always offers the free sign-up, and the WhatsApp button only with a number", () => {
    const { rerender } = render(<LandingHero />);
    expect(screen.getByRole("link", { name: new RegExp(landing.hero.primaryCta) })).toBeTruthy();
    expect(screen.queryByRole("link", { name: landing.hero.whatsappCta })).toBeNull();

    rerender(<LandingHero whatsappHref={WA} />);
    const link = screen.getByRole("link", { name: landing.hero.whatsappCta });
    expect(link.getAttribute("href")).toBe(WA);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");

    rerender(<LandingHero locale="en" whatsappHref={WA} />);
    expect(screen.getByRole("link", { name: landingEn.hero.whatsappCta })).toBeTruthy();
  });

  it("lists the reassurance chips", () => {
    render(<LandingHero />);
    for (const chip of landing.hero.chips) expect(screen.getByText(chip)).toBeTruthy();
  });
});

describe("WhatsAppSection", () => {
  it("has the heading, six capability tiles and the scripted chat", () => {
    render(<WhatsAppSection whatsappHref={WA} />);
    expect(screen.getByRole("heading", { level: 2, name: landing.whatsapp.title })).toBeTruthy();
    const tiles = within(screen.getByRole("list", { name: landing.whatsapp.tilesLabel }));
    expect(tiles.getAllByRole("listitem")).toHaveLength(6);
    for (const tile of landing.whatsapp.tiles) {
      expect(tiles.getByRole("heading", { level: 3, name: tile.title })).toBeTruthy();
    }
    expect(screen.getByRole("img", { name: landing.whatsapp.phoneLabel })).toBeTruthy();
  });

  it("shows the WhatsApp button and a server-drawn QR code only with a number", () => {
    const { container, rerender } = render(<WhatsAppSection whatsappHref={WA} />);
    expect(screen.getByRole("link", { name: landing.whatsapp.cta }).getAttribute("href")).toBe(WA);
    expect(screen.getByRole("img", { name: landing.whatsapp.qrLabel })).toBeTruthy();
    expect(container.querySelector('svg[aria-label] path[d^="M"]')).toBeTruthy();

    rerender(<WhatsAppSection />);
    expect(screen.queryByRole("link", { name: landing.whatsapp.cta })).toBeNull();
    expect(screen.queryByRole("img", { name: landing.whatsapp.qrLabel })).toBeNull();
    // The section falls back to the free sign-up.
    expect(screen.getByRole("link", { name: new RegExp(landing.hero.primaryCta) })).toBeTruthy();
  });

  it("mirrors in English", () => {
    render(<WhatsAppSection locale="en" whatsappHref={WA} />);
    expect(screen.getByRole("heading", { level: 2, name: landingEn.whatsapp.title })).toBeTruthy();
    expect(landingEn.whatsapp.tiles).toHaveLength(landing.whatsapp.tiles.length);
    expect(landingEn.whatsapp.chat).toHaveLength(landing.whatsapp.chat.length);
  });
});

describe("HowItWorks and FinalCta", () => {
  it("mention WhatsApp, with a link only when a number is set", () => {
    const { rerender } = render(<HowItWorks />);
    expect(screen.getByText(landing.how.whatsappNote)).toBeTruthy();
    expect(screen.queryByRole("link", { name: landing.how.whatsappLink })).toBeNull();
    rerender(<HowItWorks whatsappHref={WA} />);
    expect(screen.getByRole("link", { name: landing.how.whatsappLink }).getAttribute("href")).toBe(
      WA,
    );
  });

  it("offers start free and WhatsApp side by side", () => {
    const { rerender } = render(<FinalCta whatsappHref={WA} />);
    expect(screen.getByRole("link", { name: new RegExp(landing.cta.primary) })).toBeTruthy();
    expect(screen.getByRole("link", { name: landing.cta.whatsapp }).getAttribute("href")).toBe(WA);
    rerender(<FinalCta />);
    expect(screen.queryByRole("link", { name: landing.cta.whatsapp })).toBeNull();
    expect(screen.getByRole("link", { name: landing.cta.secondary })).toBeTruthy();
  });
});

describe("PrecisionWalkthrough (the journey of a line)", () => {
  it("renders the four stages as server-side text with the link to the reader page", () => {
    render(<PrecisionWalkthrough />);
    expect(screen.getByRole("heading", { level: 2, name: landing.precision.title })).toBeTruthy();
    const stages = within(screen.getByRole("list", { name: landing.precision.stepsLabel }));
    expect(stages.getAllByRole("listitem").length).toBeGreaterThanOrEqual(4);
    for (const step of landing.precision.steps) {
      expect(screen.getByRole("heading", { level: 3, name: step.title })).toBeTruthy();
    }
    expect(landing.precision.steps).toHaveLength(4);
    expect(screen.getByRole("link", { name: landing.precision.link }).getAttribute("href")).toBe(
      "/features/prescription-reader",
    );
  });

  it("shows the sample line in every stage: candidates, the duplicate warning and the schedule", () => {
    const { container } = render(<PrecisionWalkthrough />);
    const text = container.textContent ?? "";
    const { sample } = landing.precision;
    expect(text).toContain(sample.scribble);
    for (const name of sample.candidates) expect(text).toContain(name);
    expect(text).toContain(sample.duplicateBadge);
    for (const time of sample.resultTimes) expect(text).toContain(time.label);
  });

  it("numbers the stages in Western digits by default and in Arabic-Indic when the setting is off", () => {
    const western = render(<PrecisionWalkthrough />);
    const badges = [...western.container.querySelectorAll("ol > li > span")].map(
      (el) => el.textContent,
    );
    expect(badges).toEqual(["1", "2", "3", "4"]);
    western.unmount();

    const arabic = render(<PrecisionWalkthrough westernDigits={false} />);
    const indic = [...arabic.container.querySelectorAll("ol > li > span")].map(
      (el) => el.textContent,
    );
    expect(indic).toEqual(["١", "٢", "٣", "٤"]);
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
