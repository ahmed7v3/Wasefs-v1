// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { ToastProvider } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContentCalendarView } from "../src/components/admin/content-calendar-view";
import { ContentListView } from "../src/components/admin/content-list-view";
import { PersonDialog } from "../src/components/admin/content-person-dialog";
import { RedirectTester } from "../src/components/admin/content-redirects-view";
import { ContentReviewView } from "../src/components/admin/content-review-view";
import { TagMergeDialog } from "../src/components/admin/content-tags-panel";
import { MediaFocalPicker } from "../src/components/admin/media-focal-picker";
import { uploadMediaFile, type UploadState } from "../src/lib/media-upload-client";
import { ReauthProvider } from "../src/lib/reauth";

let search = "";
const replace = vi.fn<(url: string, options?: unknown) => void>();
const push = vi.fn<(url: string) => void>();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => "/admin/content",
  useSearchParams: () => new URLSearchParams(search),
}));

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;
function routes(handlers: Record<string, Handler>) {
  fetchMock.mockImplementation((input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const handler = handlers[`${method} ${url.pathname}`];
    if (!handler) return Promise.resolve(json({ code: "NOT_FOUND", message: "x" }, 404));
    return Promise.resolve(handler(url, init));
  });
}
const calls = (key: string) =>
  fetchMock.mock.calls.filter(([input, init]) => {
    const url = new URL(String(input));
    return `${init?.method ?? "GET"} ${url.pathname}` === key;
  });

/** Fails a test from inside an expression (no `!` assertions in this repo). */
function fail(): never {
  throw new Error("expected value is missing");
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeEach(() => {
  search = "";
  replace.mockReset();
  push.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function wrap(ui: React.ReactNode) {
  return render(
    <ToastProvider>
      <ReauthProvider>{ui}</ReauthProvider>
    </ToastProvider>,
  );
}

const summary = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: id(n),
  type: "article",
  locale: "ar",
  slug: `article-${String(n)}`,
  status: "draft",
  live: false,
  title: `مقال ${String(n)}`,
  category: null,
  author: null,
  reviewer: null,
  source: "editor",
  apiKeyName: null,
  scheduledAt: null,
  publishedAt: null,
  updatedAt: "2026-10-24T10:00:00.000Z",
  wordCount: 700,
  requiresReview: true,
  issues: { block: 1, warn: 2 },
  reviewOverdue: false,
  ...overrides,
});

const options = {
  categories: [
    {
      id: id(50),
      parentId: null,
      nameAr: "الأدوية",
      nameEn: null,
      slugAr: "drugs",
      slugEn: null,
      requiresMedicalReview: true,
      defaultReviewer: null,
    },
  ],
  tags: [],
  authors: [],
  reviewers: [],
};

function listRoutes(extra: Record<string, Handler> = {}) {
  routes({
    "GET /admin/settings": () => json({ items: [] }),
    "GET /admin/content/options": () => json(options),
    "GET /admin/content/people": () => json({ items: [] }),
    "GET /admin/content/items": () =>
      json({
        items: [summary(1), summary(2, { live: true, status: "published" })],
        nextCursor: null,
      }),
    ...extra,
  });
}

describe("ContentListView", () => {
  it("sends the URL filters to the list endpoint and shows status, live and issue badges", async () => {
    search = "type=article&status=draft&q=%D8%AF%D9%88%D8%A7%D8%A1&live=true";
    listRoutes();
    wrap(<ContentListView meId={id(99)} permissions={["content.read", "content.write"]} />);

    expect((await screen.findAllByText("مقال 1")).length).toBeGreaterThan(0);
    const [first] = calls("GET /admin/content/items");
    const url = new URL(String(first?.[0]));
    expect(url.searchParams.get("type")).toBe("article");
    expect(url.searchParams.get("status")).toBe("draft");
    expect(url.searchParams.get("q")).toBe("دواء");
    expect(url.searchParams.get("live")).toBe("true");
    expect(url.searchParams.get("limit")).toBe("50");
    // The live badge and the issue counts are words, not only colours.
    expect(screen.getAllByText(t("admin.content.live")).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(t("admin.content.issues.block", { count: 1 })).length,
    ).toBeGreaterThan(0);
    // «جديد» keeps the nav-link type.
    expect(
      screen.getByRole("link", { name: new RegExp(t("admin.content.new")) }).getAttribute("href"),
    ).toBe("/admin/content/new?type=article&locale=ar");
  });

  it("applies a saved view to the URL and a status chip toggles the status", async () => {
    search = "type=guide";
    listRoutes();
    wrap(<ContentListView meId={id(99)} permissions={["content.read"]} />);
    await screen.findAllByText("مقال 1");

    await userEvent.click(screen.getByRole("button", { name: t("admin.content.view.inReview") }));
    expect(replace).toHaveBeenLastCalledWith("/admin/content?type=guide&status=in_review", {
      scroll: false,
    });
    await userEvent.click(
      within(screen.getByRole("group", { name: t("admin.content.filter.status") })).getByRole(
        "button",
        { name: t("admin.content.status.published") },
      ),
    );
    expect(replace).toHaveBeenLastCalledWith("/admin/content?type=guide&status=published", {
      scroll: false,
    });
  });

  it("offers «مسوّداتي» only once the account is linked to a person", async () => {
    listRoutes({
      "GET /admin/content/people": () =>
        json({
          items: [
            {
              id: id(70),
              slug: "dr-x",
              nameAr: "د. س",
              nameEn: null,
              role: "author",
              credentialsAr: "",
              credentialsEn: "",
              licenceNumber: null,
              showLicence: false,
              bioMdAr: "",
              bioMdEn: "",
              photoMediaId: null,
              sameAs: [],
              userId: id(99),
              active: true,
              itemCount: 1,
            },
          ],
        }),
    });
    wrap(<ContentListView meId={id(99)} permissions={["content.read"]} />);
    await userEvent.click(
      await screen.findByRole("button", { name: t("admin.content.view.mine") }),
    );
    const lastUrl = String(replace.mock.calls.at(-1)?.[0]);
    expect(lastUrl).toContain("authorId=" + id(70));
    expect(lastUrl).toContain("status=draft");
  });

  it("selects rows, runs a bulk action and lists the items that failed with the reason", async () => {
    listRoutes({
      "POST /admin/content/bulk": (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { ids: string[] };
        return json({
          results: [
            { id: body.ids[0], ok: true },
            { id: body.ids[1], ok: false, code: "CONTENT_GATES_BLOCK" },
          ],
        });
      },
    });
    wrap(<ContentListView meId={id(99)} permissions={["content.read", "content.manage"]} />);
    await screen.findAllByText("مقال 1");

    await userEvent.click(
      screen.getByRole("checkbox", { name: t("admin.content.selectAll", { count: 2 }) }),
    );
    const bar = await screen.findByRole("region", { name: t("admin.content.bulk.bar") });
    expect(within(bar).getByRole("status").textContent).toBe(
      t("admin.content.bulk.selected", { count: 2 }),
    );

    await userEvent.click(
      within(bar).getByRole("button", { name: t("admin.content.bulk.setCategory") }),
    );
    const dialog = await screen.findByRole("dialog", { name: t("admin.content.bulk.setCategory") });
    await userEvent.selectOptions(
      within(dialog).getByLabelText(t("admin.content.bulk.category")),
      id(50),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: t("admin.content.bulk.apply") }),
    );

    await waitFor(() => {
      expect(calls("POST /admin/content/bulk")).toHaveLength(1);
    });
    const body = JSON.parse(String(calls("POST /admin/content/bulk")[0]?.[1]?.body)) as unknown;
    expect(body).toEqual({ action: "set_category", categoryId: id(50), ids: [id(1), id(2)] });

    expect(
      await screen.findByText(t("admin.content.bulk.result", { ok: 1, failed: 1 })),
    ).toBeTruthy();
    expect(screen.getByText(t("admin.content.error.CONTENT_GATES_BLOCK"))).toBeTruthy();
    // The results live in a polite live region; the failed item stays selected for a retry.
    expect(
      screen.getByText(t("admin.content.bulk.result", { ok: 1, failed: 1 })).closest("[aria-live]"),
    ).not.toBeNull();
    expect(
      within(screen.getByRole("region", { name: t("admin.content.bulk.bar") })).getByRole("status")
        .textContent,
    ).toBe(t("admin.content.bulk.selected", { count: 1 }));
  });

  it("opens the editor from a row", async () => {
    listRoutes();
    wrap(<ContentListView meId={id(99)} permissions={["content.read"]} />);
    const table = await screen.findByRole("table");
    await userEvent.click(
      within(table).getByRole("button", { name: t("admin.content.openItem", { title: "مقال 1" }) }),
    );
    expect(push).toHaveBeenCalledWith(`/admin/content/${id(1)}`);
  });
});

describe("ContentReviewView", () => {
  it("lists the inbox and opens the editor's Review tab", async () => {
    search = "mine=true";
    routes({
      "GET /admin/content/options": () => json(options),
      "GET /admin/content/review-inbox": () =>
        json({
          items: [
            {
              id: id(1),
              type: "article",
              locale: "ar",
              slug: "a",
              title: "مقال للمراجعة",
              category: { id: id(50), name: "الأدوية" },
              author: null,
              reviewer: null,
              submittedAt: "2026-10-20T10:00:00.000Z",
              ageHours: 100,
              diffStats: { added: 40, removed: 2 },
              hasApprovedBefore: true,
            },
          ],
          nextCursor: null,
        }),
    });
    wrap(<ContentReviewView />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText(t("admin.content.review.ageDays", { count: 4 }))).toBeTruthy();
    expect(within(table).getByText(t("admin.content.review.changes"))).toBeTruthy();
    expect(String(calls("GET /admin/content/review-inbox")[0]?.[0])).toContain("mine=true");
    await userEvent.click(within(table).getByRole("button", { name: /مقال للمراجعة/ }));
    expect(push).toHaveBeenCalledWith(`/admin/content/${id(1)}?tab=review`);
  });
});

describe("ContentCalendarView", () => {
  it("shows scheduled and published items on their zone day, as a grid and as a phone agenda", async () => {
    search = "month=2026-10";
    routes({
      "GET /admin/settings": () => json({ items: [] }),
      "GET /admin/content/items": (url) =>
        url.searchParams.get("status") === "scheduled"
          ? json({
              items: [
                summary(1, {
                  status: "scheduled",
                  scheduledAt: "2026-10-24T22:30:00.000Z",
                  title: "مجدول",
                }),
              ],
              nextCursor: null,
            })
          : json({
              items: [
                summary(2, {
                  live: true,
                  status: "published",
                  publishedAt: "2026-10-10T08:00:00.000Z",
                  title: "منشور",
                }),
              ],
              nextCursor: null,
            }),
    });
    const { container } = wrap(<ContentCalendarView />);
    await screen.findAllByText(/مجدول/);

    // 22:30 UTC on the 24th is the 25th in Cairo.
    const cell = screen.getByRole("cell", { name: /25/ });
    expect(within(cell).getByRole("link", { name: /مجدول/ })).toBeTruthy();
    const scheduledCall = new URL(String(calls("GET /admin/content/items")[0]?.[0]));
    expect(scheduledCall.searchParams.get("scheduledFrom")).toBe("2026-09-25");
    expect(scheduledCall.searchParams.get("scheduledTo")).toBe("2026-11-07");

    // Both layouts exist; CSS decides which one shows.
    expect(container.querySelector(".hidden.md\\:block")).not.toBeNull();
    const agenda = container.querySelector(".md\\:hidden");
    expect(agenda).not.toBeNull();
    expect(within(agenda as HTMLElement).getAllByRole("link")).toHaveLength(2);
    // Week starts on Saturday for Arabic: the first column is Saturday.
    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(7);
    expect(headers[0]?.textContent).toBe(
      new Intl.DateTimeFormat("ar-EG", { timeZone: "UTC", weekday: "short" }).format(
        new Date(Date.UTC(2026, 8, 26)),
      ),
    );

    await userEvent.click(screen.getByRole("button", { name: t("admin.content.calendar.next") }));
    expect(replace).toHaveBeenLastCalledWith("/admin/content?month=2026-11", { scroll: false });
  });
});

const tag = (n: number, name: string, itemCount: number) => ({
  id: id(n),
  slugAr: `tag-${String(n)}`,
  slugEn: null,
  nameAr: name,
  nameEn: null,
  descriptionAr: "",
  descriptionEn: "",
  itemCount,
});

describe("TagMergeDialog", () => {
  it("shows both counts before merging and posts from → into", async () => {
    routes({ "POST /admin/content/tags/merge": () => json(tag(2, "هدف", 8)) });
    const tags = [tag(1, "مصدر", 5), tag(2, "هدف", 3)].map((entry) => ({ ...entry }));
    const onMerged = vi.fn();
    const onClose = vi.fn();
    wrap(
      <TagMergeDialog
        open
        from={tags[0] ?? fail()}
        tags={tags}
        onClose={onClose}
        onMerged={onMerged}
      />,
    );

    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: t("admin.content.tag.mergeVerb") });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await userEvent.selectOptions(
      within(dialog).getByLabelText(new RegExp(t("admin.content.tag.mergeInto"))),
      id(2),
    );
    expect(
      within(dialog).getByText(
        t("admin.content.tag.mergeSummary", {
          from: "مصدر",
          fromCount: 5,
          into: "هدف",
          intoCount: 3,
        }),
      ),
    ).toBeTruthy();
    await userEvent.click(confirm);
    await waitFor(() => {
      expect(onMerged).toHaveBeenCalled();
    });
    expect(JSON.parse(String(calls("POST /admin/content/tags/merge")[0]?.[1]?.body))).toEqual({
      fromId: id(1),
      intoId: id(2),
    });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("PersonDialog", () => {
  it("explains that the licence number becomes public when its switch is on", async () => {
    wrap(<PersonDialog open person={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(t("admin.content.person.showLicenceOff"))).toBeTruthy();
    await userEvent.click(
      within(dialog).getByRole("checkbox", { name: t("admin.content.person.showLicence") }),
    );
    expect(within(dialog).getByText(t("admin.content.person.showLicenceOn"))).toBeTruthy();
    expect(within(dialog).queryByText(t("admin.content.person.showLicenceOff"))).toBeNull();
  });

  it("previews the public profile as plain text and accepts only https sameAs links", async () => {
    wrap(<PersonDialog open person={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${t("admin.content.field.nameAr")}`)),
      "د. سارة",
    );
    fireEvent.change(
      within(dialog).getByLabelText(new RegExp(`^${t("admin.content.person.bioAr")}`)),
      {
        target: { value: "## نبذة\nصيدلانية **معتمدة**" },
      },
    );
    const preview = within(dialog).getByTestId("profile-preview");
    expect(within(preview).getByText("د. سارة")).toBeTruthy();
    expect(within(preview).getByText("نبذة صيدلانية معتمدة")).toBeTruthy();

    const draft = within(dialog).getByLabelText(t("admin.content.person.sameAs"));
    await userEvent.type(draft, "http://insecure.example");
    await userEvent.click(
      within(dialog).getByRole("button", { name: t("admin.content.person.sameAsAdd") }),
    );
    expect(within(dialog).getByText(t("admin.content.person.sameAsInvalid"))).toBeTruthy();
    await userEvent.clear(draft);
    await userEvent.type(draft, "https://scholar.example.com/sara");
    await userEvent.click(
      within(dialog).getByRole("button", { name: t("admin.content.person.sameAsAdd") }),
    );
    expect(within(dialog).getByText("https://scholar.example.com/sara")).toBeTruthy();
    expect(within(dialog).queryByText(t("admin.content.person.sameAsInvalid"))).toBeNull();
  });
});

describe("RedirectTester", () => {
  it("shows the chain and flags a chain longer than one hop", async () => {
    routes({
      "GET /admin/content/redirects/test": () =>
        json({ finalPath: "/blog/c", chain: ["/blog/b", "/blog/c"], loop: false }),
    });
    wrap(<RedirectTester />);
    await userEvent.type(screen.getByLabelText(t("admin.content.redirect.testPath")), "/blog/a");
    await userEvent.click(
      screen.getByRole("button", { name: t("admin.content.redirect.testRun") }),
    );
    expect(await screen.findByText(t("admin.content.redirect.chain", { hops: 2 }))).toBeTruthy();
    expect(
      new URL(String(calls("GET /admin/content/redirects/test")[0]?.[0])).searchParams.get("path"),
    ).toBe("/blog/a");
    const hops = within(
      screen.getByRole("list", { name: t("admin.content.redirect.hops") }),
    ).getAllByRole("listitem");
    expect(hops.map((hop) => hop.textContent)).toEqual(["/blog/a", "/blog/b", "/blog/c"]);
  });

  it("reports a loop and surfaces an invalid-redirect error", async () => {
    routes({
      "GET /admin/content/redirects/test": () =>
        json({ finalPath: null, chain: ["/a", "/b", "/a"], loop: true }),
    });
    wrap(<RedirectTester />);
    await userEvent.type(screen.getByLabelText(t("admin.content.redirect.testPath")), "/a");
    await userEvent.click(
      screen.getByRole("button", { name: t("admin.content.redirect.testRun") }),
    );
    expect(await screen.findByText(t("admin.content.redirect.loop"))).toBeTruthy();

    routes({
      "GET /admin/content/redirects/test": () =>
        json({ code: "CONTENT_REDIRECT_INVALID", message: "x" }, 422),
    });
    await userEvent.click(
      screen.getByRole("button", { name: t("admin.content.redirect.testRun") }),
    );
    expect(await screen.findByText(t("error.CONTENT_REDIRECT_INVALID"))).toBeTruthy();
  });
});

describe("MediaFocalPicker", () => {
  it("moves with the arrow keys and from a pointer press", async () => {
    const onChange = vi.fn();
    render(
      <MediaFocalPicker
        src={null}
        width={400}
        height={200}
        alt="x"
        value={{ x: 50, y: 50 }}
        onChange={onChange}
      />,
    );
    const marker = screen.getByRole("button", {
      name: t("admin.media.focal.label", { x: 50, y: 50 }),
    });
    marker.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({ x: 51, y: 50 });
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(onChange).toHaveBeenLastCalledWith({ x: 50, y: 60 });

    const surface = screen.getByTestId("focal-surface");
    surface.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 400,
        height: 200,
        right: 400,
        bottom: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    fireEvent.pointerDown(surface, { clientX: 100, clientY: 150, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith({ x: 25, y: 75 });
  });
});

describe("uploadMediaFile", () => {
  const assetBody = (status: string, extra: Record<string, unknown> = {}) => ({
    id: id(5),
    sha256: "a".repeat(64),
    status,
    mime: "image/png",
    width: null,
    height: null,
    bytes: 4,
    focalX: 50,
    focalY: 50,
    altAr: null,
    altEn: null,
    blurDataUrl: null,
    variants: [],
    rejectReason: null,
    originalFilename: null,
    seoFilename: null,
    caption: null,
    credit: null,
    licence: "own",
    licenceRef: null,
    warnings: [],
    usageCount: 0,
    createdAt: "2026-10-24T10:00:00.000Z",
    updatedAt: "2026-10-24T10:00:00.000Z",
    ...extra,
  });

  it("hashes, requests the presigned PUT, uploads with the returned headers, commits and polls to ready", async () => {
    const put = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    routes({
      "POST /admin/media/uploads": () =>
        json({
          asset: assetBody("staged"),
          upload: {
            url: "https://bucket.example/staging/x",
            headers: { "x-amz-checksum-sha256": "abc" },
            expiresInSeconds: 600,
          },
        }),
      "POST /admin/media/00000000-0000-4000-8000-000000000005/commit": () =>
        json(assetBody("processing")),
      "GET /admin/media/00000000-0000-4000-8000-000000000005": () => json(assetBody("ready")),
    });
    const phases: UploadState["phase"][] = [];
    const file = new File([new Uint8Array([1, 2, 3, 4])], "scan.png", { type: "image/png" });
    const final = await uploadMediaFile(file, {
      fetchImpl: put,
      onPhase: (state) => phases.push(state.phase),
      poll: { intervalMs: 1, timeoutMs: 100, sleep: () => Promise.resolve() },
    });

    expect(final.phase).toBe("ready");
    expect(phases).toEqual([
      "hashing",
      "creating",
      "uploading",
      "committing",
      "processing",
      "ready",
    ]);
    const createBody = JSON.parse(
      String(calls("POST /admin/media/uploads")[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(createBody["mime"]).toBe("image/png");
    expect(createBody["bytes"]).toBe(4);
    expect(String(createBody["sha256"])).toMatch(/^[a-f0-9]{64}$/);
    const [url, init] = put.mock.calls[0] ?? fail();
    expect(url).toBe("https://bucket.example/staging/x");
    expect(init?.method).toBe("PUT");
    expect(init?.headers).toEqual({ "x-amz-checksum-sha256": "abc" });
  });

  it("skips the PUT when the same image is already ready, and rejects a bad type before any request", async () => {
    const put = vi.fn<typeof fetch>();
    routes({ "POST /admin/media/uploads": () => json({ asset: assetBody("ready") }) });
    const ok = await uploadMediaFile(
      new File([new Uint8Array([1])], "a.png", { type: "image/png" }),
      {
        fetchImpl: put,
        onPhase: () => undefined,
      },
    );
    expect(ok.phase).toBe("ready");
    expect(put).not.toHaveBeenCalled();

    fetchMock.mockClear();
    const bad = await uploadMediaFile(
      new File([new Uint8Array([1])], "a.gif", { type: "image/gif" }),
      {
        fetchImpl: put,
        onPhase: () => undefined,
      },
    );
    expect(bad).toMatchObject({ phase: "failed", error: "precheck:unsupported_type" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ends in the rejected state with the worker's reason", async () => {
    routes({
      "POST /admin/media/uploads": () =>
        json({ asset: assetBody("rejected", { rejectReason: "unreadable" }) }),
    });
    const final = await uploadMediaFile(
      new File([new Uint8Array([1])], "a.png", { type: "image/png" }),
      {
        onPhase: () => undefined,
      },
    );
    expect(final.phase).toBe("rejected");
    expect(final.asset?.rejectReason).toBe("unreadable");
  });
});
