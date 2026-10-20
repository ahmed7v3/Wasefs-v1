// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { describe, expect, it } from "vitest";

import { ContactHub } from "../src/components/contact-hub";
import { contactLinks } from "../src/lib/contact-links";

describe("contactLinks", () => {
  it("builds each link from the setting, and only for channels that are set", () => {
    expect(
      contactLinks({ whatsapp: "+201012345678", telegram: "wasfa_support", phone: "+20233334444" }),
    ).toEqual([
      { channel: "whatsapp", href: "https://wa.me/201012345678", external: true },
      { channel: "telegram", href: "https://t.me/wasfa_support", external: true },
      { channel: "phone", href: "tel:+20233334444", external: false },
    ]);
    expect(contactLinks({ whatsapp: null, telegram: "wasfa_support", phone: null })).toEqual([
      { channel: "telegram", href: "https://t.me/wasfa_support", external: true },
    ]);
    expect(contactLinks({ whatsapp: null, telegram: null, phone: null })).toEqual([]);
  });
});

describe("ContactHub", () => {
  it("renders nothing at all when no channel is set", () => {
    const { container } = render(
      <ContactHub contact={{ whatsapp: null, telegram: null, phone: null }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("opens a menu of the configured channels and closes with Escape, returning focus", async () => {
    render(
      <ContactHub contact={{ whatsapp: "+201012345678", telegram: null, phone: "+20233334444" }} />,
    );
    const button = screen.getByRole("button", { name: t("contactHub.open") });
    expect(button.getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    // The panel is loaded on first open.
    const whatsapp = await screen.findByRole("link", { name: t("contactHub.whatsapp") });
    expect(whatsapp.getAttribute("href")).toBe("https://wa.me/201012345678");
    expect(whatsapp.getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: t("contactHub.phone") }).getAttribute("href")).toBe(
      "tel:+20233334444",
    );
    expect(screen.queryByRole("link", { name: t("contactHub.telegram") })).toBeNull();
    // Focus moved into the menu.
    expect(document.activeElement).toBe(whatsapp);

    await userEvent.keyboard("{Escape}");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: t("contactHub.whatsapp") })).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
