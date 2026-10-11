// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { CONTACT_MESSAGE_MAX_LENGTH, CONTACT_TOPICS } from "@wasfa/shared/schemas/contact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContactForm } from "../src/components/marketing/contact-form";

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const starts = (label: string) => new RegExp(`^${label}`);
const nameField = () => screen.getByRole("textbox", { name: starts(t("auth.field.name")) });
const emailField = () => screen.getByRole("textbox", { name: starts(t("auth.field.email")) });
const messageField = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", { name: starts(t("contact.field.message")) });
const topicField = () =>
  screen.getByRole<HTMLSelectElement>("combobox", { name: starts(t("contact.field.topic")) });
const submit = () => screen.getByRole("button", { name: t("contact.submit") });

const MESSAGE = "أريد أن أستفسر عن موعد إطلاق الخدمة.";

async function fillAndSend() {
  await userEvent.type(nameField(), "سارة أحمد");
  await userEvent.type(emailField(), "Sara@Example.com");
  await userEvent.selectOptions(topicField(), "partnership");
  await userEvent.type(messageField(), MESSAGE);
  await userEvent.click(submit());
}

describe("ContactForm", () => {
  it("offers every topic by its translated label, starting on the general one", () => {
    render(<ContactForm />);
    const options = Array.from(topicField().options).map((option) => [
      option.value,
      option.textContent,
    ]);
    expect(options).toEqual(CONTACT_TOPICS.map((topic) => [topic, t(`contact.topic.${topic}`)]));
    expect(topicField().value).toBe("general");
  });

  it("counts the characters of the message against the limit", async () => {
    render(<ContactForm />);
    expect(
      screen.getByText(t("contact.counter", { count: 0, max: CONTACT_MESSAGE_MAX_LENGTH })),
    ).toBeTruthy();
    await userEvent.type(messageField(), "مرحبا");
    expect(
      screen.getByText(t("contact.counter", { count: 5, max: CONTACT_MESSAGE_MAX_LENGTH })),
    ).toBeTruthy();
    expect(messageField().maxLength).toBe(CONTACT_MESSAGE_MAX_LENGTH);
  });

  it("asks for an email or a phone and sends nothing while neither is given", async () => {
    render(<ContactForm />);
    await userEvent.type(nameField(), "سارة أحمد");
    await userEvent.type(messageField(), MESSAGE);
    await userEvent.click(submit());
    expect(await screen.findByText(t("contact.error.needOne"))).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the message and ends in a full confirmation", async () => {
    fetchMock.mockResolvedValue(json({ received: true }, 201));
    render(<ContactForm />);
    await fillAndSend();

    expect(await screen.findByText(t("contact.success.title"))).toBeTruthy();
    expect(screen.getByText(t("contact.success.body"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("contact.submit") })).toBeNull();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/\/contact$/);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "سارة أحمد",
      email: "sara@example.com",
      topic: "partnership",
      message: MESSAGE,
    });
  });

  it("accepts a phone number alone", async () => {
    fetchMock.mockResolvedValue(json({ received: true }, 201));
    render(<ContactForm />);
    await userEvent.type(nameField(), "سارة أحمد");
    const phone = document.querySelector<HTMLInputElement>("input[name=phone]");
    if (!phone) throw new Error("no phone field");
    await userEvent.type(phone, "+201012345678");
    await userEvent.type(messageField(), MESSAGE);
    await userEvent.click(submit());

    expect(await screen.findByText(t("contact.success.title"))).toBeTruthy();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      phone: "+201012345678",
    });
  });

  it("starts a clean form again after the confirmation", async () => {
    fetchMock.mockResolvedValue(json({ received: true }, 201));
    render(<ContactForm />);
    await fillAndSend();
    await userEvent.click(await screen.findByRole("button", { name: t("contact.success.again") }));
    expect(messageField().value).toBe("");
    expect(nameField()).toBeTruthy();
  });

  it("tells the visitor to wait on a 429 and keeps what they typed", async () => {
    fetchMock.mockResolvedValue(json({ code: "RATE_LIMITED", message: "slow down" }, 429));
    render(<ContactForm />);
    await fillAndSend();

    expect(await screen.findByText(t("error.RATE_LIMITED"))).toBeTruthy();
    await waitFor(() => {
      expect(submit().hasAttribute("disabled")).toBe(false);
    });
    expect(messageField().value).toBe(MESSAGE);
    expect(screen.queryByText(t("contact.success.title"))).toBeNull();
    // This is the support page itself: the error offers no link back to it.
    expect(screen.queryByRole("link", { name: t("common.contactSupport") })).toBeNull();
  });
});
