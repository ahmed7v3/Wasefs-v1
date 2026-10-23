// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { t } from "@wasfa/shared/i18n";
import { settingDefault } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import { BrandMark } from "../src/components/brand-mark";

const defaults = settingDefault("branding");
const LOGO = "https://api.wasfa.online/assets/logo?v=0123456789ab";

describe("BrandMark", () => {
  it("draws the built-in symbol and the name when nothing is uploaded", () => {
    const { container } = render(<BrandMark branding={defaults} />);
    expect(screen.getByRole("link", { name: t("brand.name") }).getAttribute("href")).toBe("/");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("falls back to the same symbol when no settings are passed (API down, tests)", () => {
    const { container } = render(<BrandMark />);
    expect(screen.getByText(t("brand.name"))).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders the fallback symbol with an accessible name, and the pill placeholder is gone", () => {
    render(<BrandMark branding={defaults} />);
    expect(screen.getByRole("img", { name: t("brand.name") }).tagName.toLowerCase()).toBe("svg");
    for (const file of ["brand-mark.tsx", "site-brand-mark.tsx"]) {
      // vitest runs with the web app as the working directory
      const source = readFileSync(resolve(process.cwd(), "src/components", file), "utf8");
      expect(source).not.toMatch(/\bPill\b/);
    }
  });

  it("uses the name from the settings, not the built-in one", () => {
    render(<BrandMark branding={{ ...defaults, nameAr: "صيدلية النور" }} />);
    expect(screen.getByText("صيدلية النور")).toBeTruthy();
    expect(screen.queryByText(t("brand.name"))).toBeNull();
  });

  it("shows the uploaded logo alone, named for screen readers, sized from the stored dimensions", () => {
    const { container } = render(
      <BrandMark branding={{ ...defaults, logoUrl: LOGO, logoWidth: 240, logoHeight: 80 }} />,
    );
    const image = screen.getByRole("img", { name: defaults.nameAr });
    expect(image.getAttribute("src")).toBe(LOGO);
    // 44 px tall, 3:1 -> 132 px wide, reserved before the file arrives
    expect(image.getAttribute("height")).toBe("44");
    expect(image.getAttribute("width")).toBe("132");
    expect(screen.getByRole("link", { name: defaults.nameAr })).toBeTruthy();
    // no built-in symbol, no second copy of the name
    expect(container.querySelector("svg")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("sets only the height when the logo's size is unknown", () => {
    render(<BrandMark branding={{ ...defaults, logoUrl: LOGO }} />);
    const image = screen.getByRole("img", { name: defaults.nameAr });
    expect(image.getAttribute("height")).toBe("44");
    expect(image.hasAttribute("width")).toBe(false);
  });

  it("shows the name next to the logo when the admin asked for it, without repeating it in the alt", () => {
    const { container } = render(
      <BrandMark
        branding={{
          ...defaults,
          logoUrl: LOGO,
          logoWidth: 64,
          logoHeight: 64,
          showNameWithLogo: true,
        }}
      />,
    );
    expect(screen.getByText(defaults.nameAr)).toBeTruthy();
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(screen.getByRole("link", { name: defaults.nameAr })).toBeTruthy();
  });
});
