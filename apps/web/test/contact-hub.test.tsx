// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
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
  it("is always there: with no channel set the menu holds just the site assistant", async () => {
    render(<ContactHub contact={{ whatsapp: null, telegram: null, phone: null }} />);
    await userEvent.click(screen.getByRole("button", { name: t("contactHub.open") }));
    const assistant = await screen.findByRole("link", { name: t("contactHub.assistant") });
    expect(assistant.getAttribute("href")).toBe("/ai");
    expect(
      screen.queryByRole("link", { name: new RegExp(t("contactHub.whatsappTitle")) }),
    ).toBeNull();
  });

  it("shows the labelled pill, with the WhatsApp badge only when a number is set", () => {
    const { rerender } = render(
      <ContactHub contact={{ whatsapp: "+201012345678", telegram: null, phone: null }} />,
    );
    const button = screen.getByRole("button", { name: t("contactHub.open") });
    expect(within(button).getByText(t("contactHub.open"))).toBeTruthy();
    expect(button.querySelector("svg.size-3\\.5")).toBeTruthy();

    // The app shell keeps it compact: no text label, still named for assistive technology.
    rerender(<ContactHub contact={{ whatsapp: null, telegram: null, phone: null }} compact />);
    const compact = screen.getByRole("button", { name: t("contactHub.open") });
    expect(within(compact).queryByText(t("contactHub.open"))).toBeNull();
    expect(compact.querySelector("svg.size-3\\.5")).toBeNull();
  });

  it("lists WhatsApp first, then the site assistant, then the rest; Escape returns focus", async () => {
    render(
      <ContactHub contact={{ whatsapp: "+201012345678", telegram: null, phone: "+20233334444" }} />,
    );
    const button = screen.getByRole("button", { name: t("contactHub.open") });
    expect(button.getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    // The panel is loaded on first open.
    const whatsapp = await screen.findByRole("link", {
      name: new RegExp(t("contactHub.whatsappTitle")),
    });
    expect(whatsapp.getAttribute("href")).toBe("https://wa.me/201012345678");
    expect(whatsapp.getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: t("contactHub.phone") }).getAttribute("href")).toBe(
      "tel:+20233334444",
    );
    expect(screen.queryByRole("link", { name: t("contactHub.telegram") })).toBeNull();

    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(["https://wa.me/201012345678", "/ai", "tel:+20233334444"]);
    // Focus moved into the menu, onto WhatsApp.
    expect(document.activeElement).toBe(whatsapp);

    await userEvent.keyboard("{Escape}");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: /./ })).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
