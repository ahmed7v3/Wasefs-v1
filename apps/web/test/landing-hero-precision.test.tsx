// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FinalCta } from "../src/components/home/final-cta";
import { HomeHero } from "../src/components/home/home-hero";
import { HowSection } from "../src/components/home/how-section";
import { PrecisionSection } from "../src/components/home/precision-section";
import { WhatsAppSection } from "../src/components/home/whatsapp-section";
import { landing } from "../src/content/landing";
import { landingEn } from "../src/content/landing.en";
import { whatsappUrl } from "../src/lib/contact-links";

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

describe("HomeHero", () => {
  it("renders the pill, a plain two-line H1 and the lead in reading order", () => {
    const { container } = render(<HomeHero signedIn={false} />);
    const h1 = container.querySelector("h1");
    expect(h1?.querySelectorAll("span").length).toBe(2);
    expect(h1?.textContent).toBe(landing.hero.titleLines.join(""));
    const order = [landing.hero.pill, landing.hero.titleLines.join(""), landing.hero.lead].map(
      (part) => container.textContent?.indexOf(part) ?? -1,
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((position) => position >= 0)).toBe(true);
  });

  it("signed out: start free goes to /register and sign in to /login, no dashboard link", () => {
    render(<HomeHero signedIn={false} />);
    expect(
      screen.getByRole("link", { name: new RegExp(landing.hero.primaryCta) }).getAttribute("href"),
    ).toBe("/register");
    expect(screen.getByRole("link", { name: landing.hero.signIn }).getAttribute("href")).toBe(
      "/login",
    );
    expect(screen.queryByRole("link", { name: new RegExp(landing.hero.dashboardCta) })).toBeNull();
  });

  it("signed out: shows the WhatsApp sign-up block only when one is passed", () => {
    const { rerender } = render(<HomeHero signedIn={false} />);
    expect(screen.queryByTestId("wa-signup")).toBeNull();
    rerender(<HomeHero signedIn={false} whatsappSignup={<div data-testid="wa-signup" />} />);
    expect(screen.getByTestId("wa-signup")).toBeTruthy();
  });

  it("signed in: one primary button to the dashboard and no sign-up entry points", () => {
    render(<HomeHero signedIn whatsappSignup={<div data-testid="wa-signup" />} />);
    expect(
      screen
        .getByRole("link", { name: new RegExp(landing.hero.dashboardCta) })
        .getAttribute("href"),
    ).toBe("/dashboard");
    expect(screen.queryByRole("link", { name: landing.hero.signIn })).toBeNull();
    expect(screen.queryByRole("link", { name: new RegExp(landing.hero.primaryCta) })).toBeNull();
    expect(screen.queryByTestId("wa-signup")).toBeNull();
  });

  it("speaks English on /en", () => {
    render(<HomeHero locale="en" signedIn={false} />);
    expect(screen.getByRole("link", { name: landingEn.hero.signIn })).toBeTruthy();
  });

  it("lists the reassurance chips", () => {
    render(<HomeHero signedIn={false} />);
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

describe("HowSection and FinalCta", () => {
  it("mention WhatsApp, with a link only when a number is set", () => {
    const { rerender } = render(<HowSection />);
    expect(screen.getByText(landing.how.whatsappNote)).toBeTruthy();
    expect(screen.queryByRole("link", { name: landing.how.whatsappLink })).toBeNull();
    rerender(<HowSection whatsappHref={WA} />);
    expect(screen.getByRole("link", { name: landing.how.whatsappLink }).getAttribute("href")).toBe(
      WA,
    );
  });

  it("offers start free and WhatsApp side by side", () => {
    const { rerender } = render(<FinalCta signedIn={false} whatsappHref={WA} />);
    expect(screen.getByRole("link", { name: new RegExp(landing.cta.primary) })).toBeTruthy();
    expect(screen.getByRole("link", { name: landing.cta.whatsapp }).getAttribute("href")).toBe(WA);
    rerender(<FinalCta signedIn={false} />);
    expect(screen.queryByRole("link", { name: landing.cta.whatsapp })).toBeNull();
    expect(screen.getByRole("link", { name: landing.cta.secondary })).toBeTruthy();
  });
});

describe("PrecisionSection (the journey of a line)", () => {
  it("renders the four stages as server-side text with the link to the reader page", () => {
    render(<PrecisionSection />);
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
    const { container } = render(<PrecisionSection />);
    const text = container.textContent ?? "";
    const { sample } = landing.precision;
    expect(text).toContain(sample.scribble);
    for (const name of sample.candidates) expect(text).toContain(name);
    expect(text).toContain(sample.duplicateBadge);
    for (const time of sample.resultTimes) expect(text).toContain(time.label);
  });

  it("numbers the stages in Western digits by default and in Arabic-Indic when the setting is off", () => {
    const western = render(<PrecisionSection />);
    const badges = [...western.container.querySelectorAll("ol > li > span")].map(
      (el) => el.textContent,
    );
    expect(badges).toEqual(["1", "2", "3", "4"]);
    western.unmount();

    const arabic = render(<PrecisionSection westernDigits={false} />);
    const indic = [...arabic.container.querySelectorAll("ol > li > span")].map(
      (el) => el.textContent,
    );
    expect(indic).toEqual(["١", "٢", "٣", "٤"]);
  });

  it("links to the English reader page under /en", () => {
    render(<PrecisionSection locale="en" />);
    expect(screen.getByRole("link", { name: landingEn.precision.link }).getAttribute("href")).toBe(
      "/en/features/prescription-reader",
    );
  });

  it("hides the proof strip while nothing is published", () => {
    const { container } = render(
      <PrecisionSection proof={{ avgAnalysisSeconds: null, accuracyPercent: null }} />,
    );
    expect(container.querySelector("dl")).toBeNull();
  });

  it("shows only the published figures, in Western digits by default", () => {
    const { container } = render(
      <PrecisionSection proof={{ avgAnalysisSeconds: 12.5, accuracyPercent: null }} />,
    );
    const figures = container.querySelectorAll("dl > div");
    expect(figures.length).toBe(1);
    expect(figures[0]?.textContent).toContain(landing.precision.proof.avgLabel);
    expect(figures[0]?.textContent).toContain("12.5");
  });

  it("uses Arabic-Indic digits when the admin turns Western digits off", () => {
    const { container } = render(
      <PrecisionSection
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
      <PrecisionSection
        locale="en"
        westernDigits={false}
        proof={{ avgAnalysisSeconds: 8, accuracyPercent: null }}
      />,
    );
    expect(container.querySelector("dl")?.textContent).toContain("8");
  });
});
