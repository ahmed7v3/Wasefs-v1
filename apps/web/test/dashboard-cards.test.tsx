// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreditsCard, walletOwnerLabel } from "../src/components/dashboard/credits-card";
import { RecentAnalyses } from "../src/components/dashboard/recent-analyses";
import { RecentChats } from "../src/components/dashboard/recent-chats";
import { ToolCards } from "../src/components/dashboard/tool-cards";

/*
 * Task 2.12: every data card has a loading, a loaded, an empty (where it can be empty) and an
 * error state, and the loading state takes the room of the loaded one (fixed heights).
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn() }),
}));

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const failure = () => json({ code: "INTERNAL", message: "x", ref: "WSF-ABCD-2345" }, 500);

const CREDITS = {
  wallet: { ownerType: "user", balance: 1250 },
  plan: { key: "plus", nameAr: "الباقة الذهبية", nameEn: "Gold" },
  monthlyCredits: 500,
  nextGrantAt: "2026-11-01T00:00:00.000Z",
  today: [
    { task: "rx_extract", used: 2, dailyCap: 6 },
    { task: "chat", used: 12, dailyCap: null },
    { task: "title_gen", used: 4, dailyCap: null },
  ],
  chat: { modes: ["fast", "balanced"], webSearch: false },
  wallets: [{ kind: "personal", balance: 1250 }],
  payer: { kind: "personal", fallback: false },
};

const ORG_ID = "00000000-0000-4000-8000-0000000000aa";
const ORG_CREDITS = {
  ...CREDITS,
  wallets: [
    { kind: "personal", balance: 1250 },
    {
      kind: "org",
      orgId: ORG_ID,
      orgName: "صيدلية النور",
      balance: 300,
      memberCap: { cap: 100, used: 40 },
    },
  ],
  payer: { kind: "org", orgId: ORG_ID, fallback: true },
};

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = "2026-10-14T10:00:00.000Z";

const rxItem = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n),
  status: "done",
  mode: "balanced",
  createdAt: NOW,
  itemCount: 2,
  itemNames: ["Panadol", "Augmentin"],
  pageCount: 1,
  creditsCharged: 3,
  ...over,
});

const chat = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(100 + n),
  title: `محادثة ${String(n)}`,
  skill: null,
  archived: false,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CreditsCard", () => {
  it("holds its room with a labelled skeleton while loading", () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    render(<CreditsCard />);
    expect(screen.getByRole("region", { name: t("dashboard.credits.title") })).toBeTruthy();
    expect(screen.getByRole("status", { name: t("ui.loading") })).toBeTruthy();
  });

  it("shows balance, plan, wallet owner, next grant and today's usage against the caps", async () => {
    fetchMock.mockResolvedValue(json(CREDITS));
    render(<CreditsCard />);
    const card = await screen.findByRole("region", { name: t("dashboard.credits.title") });
    await within(card).findByText(t("dashboard.credits.balance", { balance: "1,250" }));
    expect(within(card).getByText("الباقة الذهبية")).toBeTruthy();
    expect(within(card).getByText(t("dashboard.credits.owner.user"))).toBeTruthy();
    expect(within(card).getByText(/2026/)).toBeTruthy();
    expect(within(card).getByText(t("dashboard.credits.monthly", { count: "500" }))).toBeTruthy();
    // A capped task shows used of cap, an uncapped one says so, background tasks are left out.
    expect(
      within(card).getByText(t("dashboard.credits.used", { used: "2", cap: "6" })),
    ).toBeTruthy();
    expect(within(card).getByText(t("dashboard.credits.usedNoCap", { used: "12" }))).toBeTruthy();
    expect(within(card).queryByText(/title/i)).toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/me\/credits$/);
  });

  it("says nothing was used today when the plan reports no shown task", async () => {
    fetchMock.mockResolvedValue(json({ ...CREDITS, today: [] }));
    render(<CreditsCard />);
    await screen.findByText(t("dashboard.credits.todayEmpty"));
  });

  it("asks for the selected organization and says who pays, the fallback and the cap", async () => {
    fetchMock.mockResolvedValue(json(ORG_CREDITS));
    render(<CreditsCard orgId={ORG_ID} />);
    const card = await screen.findByRole("region", { name: t("dashboard.credits.title") });
    await within(card).findByText(t("dashboard.credits.balance", { balance: "300" }));
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/me/credits?orgId=${ORG_ID}`);
    const payer = within(card).getByTestId("payer");
    expect(payer.textContent).toContain(t("workspace.payer.org", { name: "صيدلية النور" }));
    expect(payer.textContent).toContain(t("workspace.payer.thenPersonal"));
    expect(payer.textContent).toContain(t("workspace.cap", { used: "40", cap: "100" }));
  });

  it("says the personal credits pay when no organization is selected", async () => {
    fetchMock.mockResolvedValue(json(CREDITS));
    render(<CreditsCard />);
    const card = await screen.findByRole("region", { name: t("dashboard.credits.title") });
    expect((await within(card).findByTestId("payer")).textContent).toContain(
      t("workspace.payer.personal"),
    );
  });

  it("forgets an organization that answers not found and refreshes", async () => {
    document.cookie = `wasfa_ctx=${ORG_ID}; path=/`;
    fetchMock.mockResolvedValue(json({ code: "NOT_FOUND", message: "x" }, 404));
    render(<CreditsCard orgId={ORG_ID} />);
    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
    expect(document.cookie).not.toContain(ORG_ID);
  });

  it("names the owner of an organization wallet", () => {
    expect(walletOwnerLabel("user")).toBe(t("dashboard.credits.owner.user"));
    expect(walletOwnerLabel("org")).toBe(t("dashboard.credits.owner.org"));
  });

  it("shows the error with its reference and loads again on retry", async () => {
    fetchMock.mockResolvedValueOnce(failure());
    render(<CreditsCard />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("WSF-ABCD-2345");
    fetchMock.mockResolvedValueOnce(json(CREDITS));
    await userEvent.click(within(alert).getByRole("button", { name: t("common.retry") }));
    await screen.findByText(t("dashboard.credits.balance", { balance: "1,250" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("RecentAnalyses", () => {
  it("asks for five and shows loading first", () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    render(<RecentAnalyses />);
    expect(screen.getByRole("status", { name: t("ui.loading") })).toBeTruthy();
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/rx\?limit=5$/);
  });

  it("lists analyses as links to their result with the drug names and status", async () => {
    fetchMock.mockResolvedValue(
      json({
        items: [rxItem(1), rxItem(2, { status: "failed", itemNames: [], itemCount: 0 })],
        nextCursor: null,
      }),
    );
    render(<RecentAnalyses />);
    const card = await screen.findByRole("region", { name: t("dashboard.rx.title") });
    const links = await within(card).findAllByRole("link", { name: /./ });
    const rows = links.filter((link) => link.getAttribute("href")?.startsWith("/analyze/"));
    expect(rows.map((link) => link.getAttribute("href"))).toEqual([
      `/analyze/${id(1)}`,
      `/analyze/${id(2)}`,
    ]);
    expect(within(rows[0] as HTMLElement).getByText("Panadol، Augmentin")).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText(t("dashboard.rx.status.done"))).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText(t("dashboard.rx.noItems"))).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText(t("dashboard.rx.status.failed"))).toBeTruthy();
  });

  it("shows at most five rows", async () => {
    fetchMock.mockResolvedValue(
      json({ items: [1, 2, 3, 4, 5, 6, 7].map((n) => rxItem(n)), nextCursor: "abc" }),
    );
    render(<RecentAnalyses />);
    await screen.findAllByText(t("dashboard.rx.status.done"));
    expect(screen.getAllByText(t("dashboard.rx.status.done"))).toHaveLength(5);
  });

  it("invites the first analysis when there are none", async () => {
    fetchMock.mockResolvedValue(json({ items: [], nextCursor: null }));
    render(<RecentAnalyses />);
    await screen.findByRole("heading", { name: t("dashboard.rx.empty") });
    expect(screen.getByRole("link", { name: t("dashboard.rx.start") }).getAttribute("href")).toBe(
      "/analyze",
    );
  });

  it("shows the error with retry", async () => {
    fetchMock.mockResolvedValueOnce(failure());
    render(<RecentAnalyses />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("button", { name: t("common.retry") })).toBeTruthy();
  });
});

describe("RecentChats", () => {
  it("asks for five and shows loading first", () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    render(<RecentChats />);
    expect(screen.getByRole("status", { name: t("ui.loading") })).toBeTruthy();
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/ai\/chats\?limit=5$/);
  });

  it("lists chats as links to the conversation, untitled ones by their default name", async () => {
    fetchMock.mockResolvedValue(
      json({ items: [chat(1), chat(2, { title: null })], nextCursor: null }),
    );
    render(<RecentChats />);
    const card = await screen.findByRole("region", { name: t("dashboard.chats.title") });
    await within(card).findByText("محادثة 1");
    const hrefs = within(card)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toContain(`/ai/${id(101)}`);
    expect(hrefs).toContain(`/ai/${id(102)}`);
    expect(within(card).getByText(t("chat.untitled"))).toBeTruthy();
  });

  it("invites the first chat when there are none", async () => {
    fetchMock.mockResolvedValue(json({ items: [], nextCursor: null }));
    render(<RecentChats />);
    await screen.findByRole("heading", { name: t("dashboard.chats.empty") });
    expect(
      screen.getByRole("link", { name: t("dashboard.chats.start") }).getAttribute("href"),
    ).toBe("/ai");
  });

  it("shows the error with retry", async () => {
    fetchMock.mockResolvedValueOnce(failure());
    render(<RecentChats />);
    const alert = await screen.findByRole("alert");
    await waitFor(() => {
      expect(within(alert).getByRole("button", { name: t("common.retry") })).toBeTruthy();
    });
  });
});

describe("ToolCards", () => {
  it("offers the six tools as links: analysis to /analyze, the five skills to /ai with the skill chosen", () => {
    render(<ToolCards />);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(6);
    expect(screen.queryByText(t("ui.comingSoon"))).toBeNull();
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([
      "/analyze",
      "/ai?skill=drug-info",
      "/ai?skill=lab-test-interpretation",
      "/ai?skill=imaging-educational",
      "/ai?skill=dose-calculator",
      "/ai?skill=drug-interaction-check",
    ]);
  });
});
