// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppWaitlistForm } from "../src/components/marketing/app-waitlist-form";
import { landing } from "../src/content/landing";

const copy = landing.apps.waitlist;
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

const email = () => screen.getByRole("textbox", { name: new RegExp(`^${copy.email}`) });
const consent = () => screen.getByRole<HTMLInputElement>("checkbox");
const submit = () => screen.getByRole("button", { name: copy.submit });

async function fill(withConsent = true) {
  await userEvent.type(email(), "sara@example.com");
  await userEvent.selectOptions(screen.getByRole("combobox"), "ios");
  if (withConsent) await userEvent.click(consent());
  await userEvent.click(submit());
}

describe("AppWaitlistForm", () => {
  it("starts with an unticked, required consent and offers the three platforms", () => {
    render(<AppWaitlistForm locale="ar" copy={copy} />);
    expect(consent().checked).toBe(false);
    expect(consent().required).toBe(true);
    const options = Array.from(screen.getByRole<HTMLSelectElement>("combobox").options);
    expect(options.map((option) => option.value)).toEqual(["android", "ios", "both"]);
  });

  it("sends nothing without a valid email and an explicit consent", async () => {
    render(<AppWaitlistForm locale="ar" copy={copy} />);
    await userEvent.type(email(), "not-an-email");
    await userEvent.click(submit());
    expect(await screen.findByText(copy.consentRequired)).toBeTruthy();
    expect(email().getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the answers with the page locale and confirms on 202", async () => {
    fetchMock.mockResolvedValueOnce(json({ received: true }, 202));
    render(<AppWaitlistForm locale="en" copy={copy} />);
    await fill();
    expect(await screen.findByText(copy.successTitle)).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/\/public\/app-waitlist$/);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      email: "sara@example.com",
      platform: "ios",
      marketingConsent: true,
      locale: "en",
    });
  });

  it("says the list is closed when the api answers 404 (waitlist switched off)", async () => {
    fetchMock.mockResolvedValueOnce(json({ code: "NOT_FOUND", message: "x" }, 404));
    render(<AppWaitlistForm locale="ar" copy={copy} />);
    await fill();
    expect(await screen.findByText(copy.disabled)).toBeTruthy();
    expect(screen.queryByRole("button", { name: copy.submit })).toBeNull();
  });

  it("keeps the form and shows an error on a network failure", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    render(<AppWaitlistForm locale="ar" copy={copy} />);
    await fill();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(submit()).toBeTruthy();
    expect(screen.queryByText(copy.successTitle)).toBeNull();
  });
});
