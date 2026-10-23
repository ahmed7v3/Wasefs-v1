// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { settingDefault, type PublicSettings } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import { AppsBand } from "../src/components/marketing/apps-band";
import { FaqSection } from "../src/components/marketing/faq-section";
import { SiteFooter, footerColumns } from "../src/components/marketing/site-footer";
import { landing } from "../src/content/landing";
import { landingEn } from "../src/content/landing.en";
import { PUBLIC_PAGES } from "../src/lib/seo";
import { faqJsonLd } from "../src/lib/structured-data";

function settings(overrides: Partial<PublicSettings["landing"]["apps"]> = {}): PublicSettings {
  const base = settingDefault("landing");
  return {
    branding: settingDefault("branding"),
    contact: settingDefault("contact"),
    socials: settingDefault("socials"),
    locale: settingDefault("locale"),
    currency: settingDefault("currency"),
    access: settingDefault("access"),
    free_tier: settingDefault("free_tier"),
    rx: settingDefault("rx"),
    seo: settingDefault("seo"),
    landing: { ...base, apps: { ...base.apps, ...overrides } },
  };
}

describe("SiteFooter", () => {
  it("links the Arabic pages for ar and the /en counterparts for en", () => {
    const ar = footerColumns("ar").flatMap((column) => column.links.map((link) => link.href));
    expect(ar).toEqual([
      "/features/prescription-reader",
      "/features/handwritten-prescriptions",
      "/features/medicine-explainer",
      "/features/ai-assistant",
      "/pricing",
      "/for/pharmacists",
      "/for/clinics",
      "/about",
      "/editorial-policy",
      "/medical-review",
      "/sources",
      "/contact",
      "/privacy",
      "/terms",
      "/disclaimer",
    ]);
    const en = footerColumns("en").flatMap((column) => column.links.map((link) => link.href));
    expect(en.slice(0, 11)).toEqual(ar.slice(0, 11).map((href) => `/en${href}`));
    expect(en[11]).toBe("/en/contact");
    // Legal pages have no English version yet (`PUBLIC_PAGES[*].pathEn` is null): the Arabic original.
    expect(PUBLIC_PAGES.privacy.pathEn).toBeNull();
    expect(en.slice(12)).toEqual(["/privacy", "/terms", "/disclaimer"]);
  });

  it("renders the columns, apps chips and only the social profiles that are set", () => {
    const withSocial = settings();
    withSocial.socials = { ...withSocial.socials, x: "https://x.com/wasfa" };
    render(<SiteFooter settings={withSocial} locale="en" path="/en" />);
    for (const column of ["product", "company", "legal"] as const) {
      expect(screen.getByRole("heading", { name: landingEn.footer[column] })).toBeTruthy();
    }
    expect(screen.getByText(landingEn.footer.appsSoon)).toBeTruthy();
    expect(screen.getAllByText(`· ${landingEn.apps.soon}`)).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "X" })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Facebook" })).toBeNull();
    // The language switch leads back to the Arabic home.
    expect(screen.getByRole("link", { name: "العربية" }).getAttribute("href")).toBe("/");
  });

  it("keeps the contact email inside the Cloudflare email_off markers", () => {
    const withEmail = settings();
    withEmail.contact = { ...withEmail.contact, email: "hello@wasfa.online" };
    const { container } = render(<SiteFooter settings={withEmail} />);
    const html = container.innerHTML;
    expect(html.indexOf("<!--email_off-->")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("<!--email_off-->")).toBeLessThan(html.indexOf("hello@wasfa.online"));
  });
});

describe("FaqSection", () => {
  it("groups the items by the `name` attribute while exclusive, and keeps every question", () => {
    const { container } = render(<FaqSection />);
    const items = Array.from(container.querySelectorAll("details"));
    expect(items).toHaveLength(landing.faq.items.length);
    expect(new Set(items.map((item) => item.getAttribute("name")))).toEqual(new Set(["faq"]));
    expect(items.map((item) => item.querySelector("summary")?.textContent)).toEqual(
      landing.faq.items.map((item) => item.question),
    );
  });

  it("feeds the FAQPage JSON-LD from the same items", () => {
    const data = faqJsonLd(landing.faq.items);
    expect(data["mainEntity"]).toHaveLength(landing.faq.items.length);
    expect(landing.faq.exclusive).toBe(true);
  });
});

describe("AppsBand", () => {
  it("shows neutral coming-soon chips and no form by default", () => {
    render(<AppsBand settings={settings()} />);
    expect(screen.getByRole("heading", { name: landing.apps.title })).toBeTruthy();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getAllByText(`· ${landing.apps.soon}`)).toHaveLength(2);
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByText(landing.apps.waitlist.title)).toBeNull();
  });

  it("turns a chip into a plain store link once its URL is set", () => {
    render(
      <AppsBand settings={settings({ androidUrl: "https://play.google.com/store/apps/x" })} />,
    );
    const link = screen.getByRole("link", { name: landing.apps.googlePlay });
    expect(link.getAttribute("href")).toBe("https://play.google.com/store/apps/x");
    expect(screen.queryByRole("link", { name: landing.apps.appStore })).toBeNull();
    expect(screen.getAllByText(`· ${landing.apps.soon}`)).toHaveLength(1);
  });

  it("renders the waitlist form only while the setting is on, in the page language", async () => {
    // The form is a lazy island (fetched after the page), so it appears a moment after the first render.
    const { rerender } = render(<AppsBand settings={settings({ waitlistEnabled: true })} />);
    expect(await screen.findByRole("form", { name: landing.apps.waitlist.title })).toBeTruthy();
    rerender(<AppsBand settings={settings({ waitlistEnabled: true })} locale="en" />);
    const form = await screen.findByRole("form", { name: landingEn.apps.waitlist.title });
    expect(within(form).getByLabelText(new RegExp(landingEn.apps.waitlist.email))).toBeTruthy();
    expect(screen.getByRole("heading", { name: landingEn.apps.title })).toBeTruthy();
  });
});
