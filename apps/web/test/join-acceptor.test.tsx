// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { t } from "@wasfa/shared/i18n";
import { ToastProvider } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JoinAcceptor } from "../src/components/join/join-acceptor";
import { JOIN_COOKIE } from "../src/lib/attribution-cookies";
import { readBrowserCookie, writeBrowserCookie } from "../src/lib/browser-cookies";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const ORG_ID = "00000000-0000-4000-8000-0000000000aa";
const LANDING = {
  valid: true,
  org: { name: "صيدلية النور" },
  benefit: null,
  approval: "auto_approve",
};
const VERIFIED = { email: true, phone: true };

function mount(verified = VERIFIED) {
  return render(
    <ToastProvider>
      <JoinAcceptor verified={verified} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  sessionStorage.clear();
  writeBrowserCookie(JOIN_COOKIE, "al-nour", 7);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = `${JOIN_COOKIE}=; Path=/; Max-Age=0`;
});

describe("JoinAcceptor", () => {
  it("accepts the remembered link once the account is verified, then forgets it", async () => {
    fetchMock
      .mockResolvedValueOnce(json(LANDING))
      .mockResolvedValueOnce(json({ outcome: "joined", orgId: ORG_ID }));
    mount();
    await screen.findByText(t("join.accepted.joined", { org: "صيدلية النور" }));
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/join/al-nour/accept");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(readBrowserCookie(JOIN_COOKIE)).toBeUndefined();
    expect(refresh).toHaveBeenCalled();
  });

  it("says the request waits for an admin when the link needs approval", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ ...LANDING, approval: "requires_approval" }))
      .mockResolvedValueOnce(json({ outcome: "pending", orgId: ORG_ID }));
    mount();
    await screen.findByText(t("join.accepted.pending", { org: "صيدلية النور" }));
  });

  it("keeps the link and explains what is missing while the account is not verified", async () => {
    mount({ email: true, phone: false });
    await screen.findByText(t("join.pending.phone"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readBrowserCookie(JOIN_COOKIE)).toBe("al-nour");
  });

  it("keeps the link when the API still asks for verification", async () => {
    fetchMock.mockResolvedValueOnce(json(LANDING)).mockResolvedValueOnce(
      json(
        {
          code: "FORBIDDEN",
          message: "x",
          details: { reason: "verification_required" },
        },
        403,
      ),
    );
    mount();
    await screen.findByText(t("join.pending.both"));
    expect(readBrowserCookie(JOIN_COOKIE)).toBe("al-nour");
  });

  it("drops a link that is no longer valid", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ valid: false }))
      .mockResolvedValueOnce(json({ code: "NOT_FOUND", message: "x" }, 404));
    mount();
    await waitFor(() => {
      expect(readBrowserCookie(JOIN_COOKIE)).toBeUndefined();
    });
    await screen.findByText(t("join.invalid"));
  });

  it("does nothing without a join cookie", () => {
    document.cookie = `${JOIN_COOKIE}=; Path=/; Max-Age=0`;
    mount();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
