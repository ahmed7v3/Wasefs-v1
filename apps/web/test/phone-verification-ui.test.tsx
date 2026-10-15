// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PhoneVerification } from "../src/components/phone-verification";

type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fetchMock = vi.fn<typeof fetch>();
const available = { available: true, bridge: "connected" };

function route(handler: Handler) {
  fetchMock.mockImplementation((input, init) =>
    Promise.resolve(handler(String(input), init as RequestInit | undefined)),
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PhoneVerification", () => {
  it("shows a calm notice, and tells the parent, when the feature is unavailable", async () => {
    route(() => json({ status: "none", available: false, unavailableReason: "bridge_down" }));
    const onUnavailable = vi.fn();
    render(<PhoneVerification onVerified={vi.fn()} onUnavailable={onUnavailable} />);
    expect(await screen.findByText(t("phone.unavailable.title"))).toBeTruthy();
    expect(screen.getByText(t("phone.unavailable.bridgeDown"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("phone.verify.start") })).toBeNull();
    // The parent is told from an effect that runs after the notice paints.
    await waitFor(() => {
      expect(onUnavailable).toHaveBeenCalledTimes(1);
    });
  });

  it("reports an already verified number once", async () => {
    route(() => json({ status: "verified", phone: "+201012345678", ...available }));
    const onVerified = vi.fn();
    render(<PhoneVerification onVerified={onVerified} />);
    expect(await screen.findByText(t("phone.verified.title"))).toBeTruthy();
    await waitFor(() => {
      expect(onVerified).toHaveBeenCalledTimes(1);
    });
  });

  it("starts, shows the WhatsApp link and the code, then verifies by polling", async () => {
    let polls = 0;
    route((url, init) => {
      if (url.endsWith("/phone/verify/start")) {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(JSON.stringify({ phoneNumber: "+201012345678" }));
        return json({
          status: "pending",
          code: "482913",
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          waLink: "https://wa.me/201000000000?text=code",
          waNumber: "+201000000000",
        });
      }
      polls += 1;
      if (polls === 1) return json({ status: "none", ...available });
      return polls < 4
        ? json({ status: "pending", phone: "+201012345678", ...available })
        : json({ status: "verified", phone: "+201012345678", ...available });
    });
    // Fake timers from the start, so the 2 s poll interval is created under them.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const onVerified = vi.fn();
    render(<PhoneVerification onVerified={onVerified} />);

    await user.type(await screen.findByRole("textbox"), "01012345678");
    await user.click(screen.getByRole("button", { name: t("phone.verify.start") }));

    const open = await screen.findByRole("link", { name: t("phone.waiting.openWhatsapp") });
    expect(open.getAttribute("href")).toBe("https://wa.me/201000000000?text=code");
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toContain("noopener");
    const code = screen.getByText("482913");
    expect(code.getAttribute("dir")).toBe("ltr");
    expect(screen.getByText(t("phone.waiting.status"))).toBeTruthy();
    // The QR is an SVG data: URL (img-src allows data:), only displayed from md up by CSS.
    const qr = await screen.findByAltText(t("phone.waiting.qrAlt"));
    expect(qr.getAttribute("src")).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    await waitFor(() => {
      expect(onVerified).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText(t("phone.verified.title"))).toBeTruthy();
  });

  it("falls back to the form for a refusal with a phone_verification reason", async () => {
    route((url) =>
      url.endsWith("/phone/verify/start")
        ? json(
            {
              code: "FORBIDDEN",
              message: "x",
              details: { reason: "phone_verification_disabled" },
            },
            403,
          )
        : json({ status: "none", ...available }),
    );
    render(<PhoneVerification onVerified={vi.fn()} />);
    await userEvent.type(await screen.findByRole("textbox"), "01012345678");
    await userEvent.click(screen.getByRole("button", { name: t("phone.verify.start") }));
    expect(await screen.findByText(t("phone.unavailable.disabled"))).toBeTruthy();
  });

  it("explains a number that is already linked to another account", async () => {
    route(() => json({ status: "failed", failureReason: "phone_in_use", ...available }));
    render(<PhoneVerification onVerified={vi.fn()} />);
    expect(await screen.findByText(t("phone.failed.phoneInUse"))).toBeTruthy();
    expect(screen.getByRole("button", { name: t("common.retry") })).toBeTruthy();
  });
});
