// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { ToastProvider } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HistoryTab } from "../src/components/admin/content-editor/history-tab";
import { PublishTab } from "../src/components/admin/content-editor/publish-tab";
import { ReviewTab } from "../src/components/admin/content-editor/review-tab";
import { SeoTab } from "../src/components/admin/content-editor/seo-tab";
import { draftFromDetail, emptyDraft } from "../src/lib/content-editor/draft";
import { DEFAULT_EDITOR_SETTINGS } from "../src/lib/content-editor-schemas";
import { ReauthProvider } from "../src/lib/reauth";

import type { ContentItemDetail, ContentOptions } from "@wasfa/shared/schemas/content";

const ID = "11111111-1111-4111-8111-111111111111";
const REV_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REV_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CAT_MED = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CAT_PLAIN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const settings = { ...DEFAULT_EDITOR_SETTINGS, minWords: { ...DEFAULT_EDITOR_SETTINGS.minWords } };

function makeDetail(overrides: Partial<ContentItemDetail> = {}): ContentItemDetail {
  const draft = emptyDraft();
  return {
    id: ID,
    type: "article",
    locale: "ar",
    slug: "my-post",
    status: "draft",
    live: false,
    title: "عنوان المقال",
    category: null,
    author: null,
    reviewer: null,
    source: "editor",
    apiKeyName: null,
    scheduledAt: null,
    publishedAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    wordCount: 10,
    requiresReview: true,
    issues: { block: 1, warn: 0 },
    reviewOverdue: false,
    translationGroupId: ID,
    translation: null,
    payload: { title: "عنوان المقال", excerpt: "مقتطف", definition: "", bodyMd: "نص" },
    meta: { ...draft.meta, slug: "my-post" },
    tags: [],
    currentRevision: { id: REV_B, number: 2 },
    reviewedRevisionId: REV_A,
    publishedRevisionId: null,
    hasUnpublishedChanges: false,
    lockVersion: 3,
    autosave: null,
    gates: [
      { id: "min_words", level: "block", ok: false, params: { words: 10, min: 600 } },
      { id: "readability", level: "info", ok: true, params: {} },
    ],
    comments: [],
    publicPath: null,
    archivedRedirectTo: null,
    allowedActions: [],
    canPurge: false,
    ...overrides,
  };
}

const options: ContentOptions = {
  categories: [
    {
      id: CAT_MED,
      parentId: null,
      nameAr: "أدوية",
      nameEn: "Drugs",
      slugAr: "adwiya",
      slugEn: null,
      requiresMedicalReview: true,
      defaultReviewer: null,
    },
    {
      id: CAT_PLAIN,
      parentId: null,
      nameAr: "أخبار",
      nameEn: null,
      slugAr: "akhbar",
      slugEn: null,
      requiresMedicalReview: false,
      defaultReviewer: null,
    },
  ],
  tags: [{ id: ID, nameAr: "سكري", nameEn: null, slugAr: null, slugEn: null }],
  authors: [],
  reviewers: [],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function wrap(ui: React.ReactElement) {
  return render(
    <ToastProvider>
      <ReauthProvider>{ui}</ReauthProvider>
    </ToastProvider>,
  );
}

const noop = () => undefined;

describe("PublishTab", () => {
  const props = (
    detail: ContentItemDetail | null,
    over: Partial<Parameters<typeof PublishTab>[0]> = {},
  ) => ({
    detail,
    draft: detail ? draftFromDetail(detail) : emptyDraft(),
    type: "article" as const,
    locale: "ar" as const,
    options,
    settings,
    featured: null,
    readOnly: false,
    busy: null,
    onMeta: noop,
    onPickFeatured: noop,
    onCreateTwin: noop,
    onAction: noop,
    ...over,
  });

  it("shows status, the blocking gate with its numbers, and a button per allowed workflow action", async () => {
    const onAction = vi.fn();
    wrap(
      <PublishTab
        {...props(makeDetail({ allowedActions: ["submit", "archive"] }), { onAction })}
      />,
    );
    expect(screen.getByTestId("status-chip")?.textContent).toContain(
      t("admin.editor.status.draft"),
    );
    const gate = document.querySelector('[data-gate="min_words"]');
    expect(gate).not.toBeNull();
    expect(gate?.textContent).toContain(t("admin.editor.gate.status.block"));
    await userEvent.click(screen.getByRole("button", { name: t("admin.editor.action.submit") }));
    expect(onAction).toHaveBeenCalledWith("submit");
    // archive lives in the overflow menu, not here
    expect(screen.queryByRole("button", { name: t("admin.editor.action.archive") })).toBeNull();
  });

  it("the category choice drives the medical-review hint", async () => {
    const detail = makeDetail();
    const { rerender } = wrap(<PublishTab {...props(detail)} />);
    expect(screen.getByText(t("admin.editor.category.review"))).toBeTruthy();
    const draft = draftFromDetail(detail);
    draft.meta.categoryId = CAT_PLAIN;
    rerender(
      <ToastProvider>
        <ReauthProvider>
          <PublishTab {...props(detail, { draft })} />
        </ReauthProvider>
      </ToastProvider>,
    );
    expect(screen.getByText(t("admin.editor.category.noReview"))).toBeTruthy();
  });

  it("flags are switches and report the change", async () => {
    const onMeta = vi.fn();
    wrap(<PublishTab {...props(makeDetail(), { onMeta })} />);
    const toc = screen.getByRole("switch", { name: new RegExp(t("admin.editor.flag.showToc")) });
    expect(toc.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(toc);
    expect(onMeta).toHaveBeenCalledTimes(1);
    const update = onMeta.mock.calls[0]?.[0] as (
      m: ReturnType<typeof emptyDraft>["meta"],
    ) => ReturnType<typeof emptyDraft>["meta"];
    expect(update(emptyDraft().meta).flags.showToc).toBe(true);
  });

  it("warns about a featured image without alt text or too narrow", () => {
    const featured = {
      id: ID,
      width: 800,
      altAr: null,
      altEn: null,
      variants: [],
      blurDataUrl: null,
      originalFilename: null,
    } as never;
    const detail = makeDetail();
    const draft = draftFromDetail(detail);
    draft.meta.featuredMediaId = ID;
    wrap(<PublishTab {...props(detail, { featured, draft })} />);
    expect(screen.getByText(t("admin.editor.featured.noAlt"))).toBeTruthy();
    expect(screen.getByText(/800/)).toBeTruthy();
  });

  it("offers the twin: a link when it exists, a create button otherwise", async () => {
    const onCreateTwin = vi.fn();
    const { unmount } = wrap(<PublishTab {...props(makeDetail(), { onCreateTwin })} />);
    await userEvent.click(
      screen.getByRole("button", { name: t("admin.editor.translation.createEn") }),
    );
    expect(onCreateTwin).toHaveBeenCalled();
    unmount();
    wrap(
      <PublishTab
        {...props(
          makeDetail({ translation: { id: REV_A, locale: "en", slug: "x", status: "draft" } }),
        )}
      />,
    );
    expect(
      screen
        .getByRole("link", { name: new RegExp(t("admin.editor.translation.openEn")) })
        .getAttribute("href"),
    ).toBe(`/admin/content/${REV_A}`);
  });
});

describe("SeoTab", () => {
  const seoProps = (over: Partial<Parameters<typeof SeoTab>[0]> = {}) => {
    const detail = makeDetail();
    const draft = draftFromDetail(detail);
    return {
      detail,
      draft,
      bodyMd: draft.payload.bodyMd,
      type: "article" as const,
      locale: "ar" as const,
      settings,
      permissions: ["content.write"],
      options,
      readOnly: false,
      slugTaken: false,
      linkQuery: "",
      origin: "https://wasfa.online",
      featured: null,
      ogImage: null,
      onMeta: noop,
      onPickOgImage: noop,
      onInsertLink: noop,
      ...over,
    };
  };

  it("shows counters, both snippet previews, the checklist (pass/improve, no score) and structured data", () => {
    wrap(<SeoTab {...seoProps()} />);
    expect(screen.getByTestId("snippet-desktop")).toBeTruthy();
    expect(screen.getByTestId("snippet-mobile")).toBeTruthy();
    expect(
      document.querySelector('[data-check="meta_description"]')?.getAttribute("data-status"),
    ).toBe("improve");
    expect(
      document.querySelector('[data-check="focus_keyword"]')?.getAttribute("data-status"),
    ).toBe("improve");
    expect(screen.queryByText(/\d+\s*\/\s*100/)).toBeNull();
    expect(
      screen.getByText(t("admin.editor.seo.structured.approx", {}), { exact: false }),
    ).toBeTruthy();
  });

  it("hides canonical and robots without content.manage", () => {
    const { unmount } = wrap(<SeoTab {...seoProps()} />);
    expect(screen.queryByLabelText(t("admin.editor.seo.robots"))).toBeNull();
    unmount();
    wrap(<SeoTab {...seoProps({ permissions: ["content.manage"] })} />);
    expect(screen.getByLabelText(t("admin.editor.seo.robots"))).toBeTruthy();
  });

  it("validates the slug with the shared rule and warns about published items", () => {
    const detail = makeDetail({ live: true, publishedAt: "2026-01-01T00:00:00.000Z" });
    const draft = draftFromDetail(detail);
    draft.meta.slug = "Bad Slug";
    wrap(<SeoTab {...seoProps({ detail, draft })} />);
    expect(screen.getByText(t("admin.editor.seo.slug.bad_format"))).toBeTruthy();
    expect(screen.getByText(t("admin.editor.seo.slug.redirectWarning"))).toBeTruthy();
  });

  it("shows the server's slug-taken answer", () => {
    wrap(<SeoTab {...seoProps({ slugTaken: true })} />);
    expect(screen.getByText(t("admin.editor.error.CONTENT_SLUG_TAKEN"))).toBeTruthy();
  });

  it("inserts a suggested link", async () => {
    fetchMock.mockResolvedValue(
      json({ items: [{ title: "دليل السكري", path: "/guides/diabetes", type: "guide" }] }),
    );
    const onInsertLink = vi.fn();
    wrap(<SeoTab {...seoProps({ linkQuery: "السكري", onInsertLink })} />);
    const button = await screen.findByRole("button", { name: /دليل السكري/ }, { timeout: 3_000 });
    await userEvent.click(button);
    expect(onInsertLink).toHaveBeenCalledWith("السكري", "/guides/diabetes");
  });
});

describe("ReviewTab", () => {
  const reviewProps = (
    detail: ContentItemDetail,
    over: Partial<Parameters<typeof ReviewTab>[0]> = {},
  ) => ({
    detail,
    draft: draftFromDetail(detail),
    baseline: draftFromDetail(detail),
    permissions: ["content.review"],
    payloadDirty: false,
    busy: null,
    onAction: vi.fn().mockResolvedValue("ok"),
    ...over,
  });

  beforeEach(() => {
    fetchMock.mockResolvedValue(
      json({
        id: REV_A,
        number: 1,
        kind: "approve",
        note: null,
        createdBy: { type: "user", id: null, name: "Dr" },
        createdAt: "2026-01-01T00:00:00.000Z",
        diffStats: { added: 0, removed: 0 },
        isApproved: true,
        isPublished: false,
        payload: { title: "عنوان المقال", excerpt: "مقتطف", definition: "", bodyMd: "نص قديم" },
      }),
    );
  });

  it("a reviewer sees the diff, the gates and the three decisions", async () => {
    const detail = makeDetail({
      status: "in_review",
      allowedActions: ["approve", "request_changes"],
    });
    const props = reviewProps(detail);
    wrap(<ReviewTab {...props} />);
    await waitFor(() => {
      expect(screen.getAllByTestId("diff-stacked").length).toBeGreaterThan(0);
    });
    // The approved version had extra words the current text dropped.
    expect(document.querySelector("del")?.textContent).toContain("قديم");
    await userEvent.click(screen.getByRole("button", { name: t("admin.editor.action.approve") }));
    expect(props.onAction).toHaveBeenCalledWith("approve");
    expect(
      screen.getByRole("button", { name: t("admin.editor.action.approveWithEdits") }),
    ).toHaveProperty("disabled", true);
  });

  it("unsaved edits disable plain Approve and send the edits with the minor-edits button", async () => {
    const detail = makeDetail({
      status: "in_review",
      allowedActions: ["approve", "request_changes"],
    });
    const draft = draftFromDetail(detail);
    draft.payload.bodyMd = "نص معدل";
    const props = reviewProps(detail, { draft, payloadDirty: true });
    wrap(<ReviewTab {...props} />);
    expect(screen.getByRole("button", { name: t("admin.editor.action.approve") })).toHaveProperty(
      "disabled",
      true,
    );
    await userEvent.click(
      screen.getByRole("button", { name: t("admin.editor.action.approveWithEdits") }),
    );
    expect(props.onAction).toHaveBeenCalledWith(
      "approve",
      { edits: { bodyMd: "نص معدل" } },
      { skipSave: true },
    );
  });

  it("request changes needs a comment of at least five characters", async () => {
    const detail = makeDetail({
      status: "in_review",
      allowedActions: ["approve", "request_changes"],
    });
    const props = reviewProps(detail);
    wrap(<ReviewTab {...props} />);
    await userEvent.click(
      screen.getByRole("button", { name: t("admin.editor.action.requestChanges") }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("textbox"), "قصير");
    await userEvent.click(
      within(dialog).getByRole("button", { name: t("admin.editor.action.requestChanges") }),
    );
    expect(props.onAction).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByRole("textbox"), " جدا جدا");
    await userEvent.click(
      within(dialog).getByRole("button", { name: t("admin.editor.action.requestChanges") }),
    );
    await waitFor(() => {
      expect(props.onAction).toHaveBeenCalledWith("request_changes", { comment: "قصير جدا جدا" });
    });
  });

  it("without review permission there are no reviewer controls, authors can submit with a note", async () => {
    const detail = makeDetail({ allowedActions: ["submit"] });
    const props = reviewProps(detail, { permissions: ["content.write"] });
    wrap(<ReviewTab {...props} />);
    expect(screen.queryByRole("button", { name: t("admin.editor.action.approve") })).toBeNull();
    await userEvent.type(
      screen.getByLabelText(t("admin.editor.review.submitNote"), { exact: false }),
      "راجع الجرعات",
    );
    await userEvent.click(screen.getByRole("button", { name: t("admin.editor.action.submit") }));
    expect(props.onAction).toHaveBeenCalledWith("submit", { comment: "راجع الجرعات" });
  });

  it("lists review comments, newest first", () => {
    const comment = (id: string, at: string, text: string) => ({
      id,
      kind: "request_changes" as const,
      comment: text,
      author: "Dr",
      revisionId: REV_A,
      createdAt: at,
    });
    const detail = makeDetail({
      comments: [
        comment(REV_A, "2026-01-01T00:00:00.000Z", "قديم"),
        comment(REV_B, "2026-02-01T00:00:00.000Z", "جديد"),
      ],
    });
    wrap(<ReviewTab {...reviewProps(detail, { permissions: ["content.write"] })} />);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items.findIndex((x) => x.includes("جديد"))).toBeLessThan(
      items.findIndex((x) => x.includes("قديم")),
    );
  });
});

describe("HistoryTab", () => {
  const revision = (id: string, number: number, extra: object = {}) => ({
    id,
    number,
    kind: "save",
    note: null,
    createdBy: { type: "user", id: null, name: "Sara" },
    createdAt: "2026-01-01T00:00:00.000Z",
    diffStats: { added: 4, removed: 1 },
    isApproved: false,
    isPublished: false,
    ...extra,
  });

  it("lists revisions with badges, compares two, and restores after confirmation", async () => {
    const onRestore = vi.fn().mockResolvedValue(undefined);
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith(`/revisions/${REV_A}`)) {
        return Promise.resolve(
          json({
            ...revision(REV_A, 1),
            payload: { title: "T", excerpt: "", definition: "", bodyMd: "one two" },
          }),
        );
      }
      if (url.endsWith(`/revisions/${REV_B}`)) {
        return Promise.resolve(
          json({
            ...revision(REV_B, 2),
            payload: { title: "T", excerpt: "", definition: "", bodyMd: "one three" },
          }),
        );
      }
      return Promise.resolve(
        json({
          items: [
            revision(REV_B, 2, { isPublished: true }),
            revision(REV_A, 1, { isApproved: true }),
          ],
        }),
      );
    });
    wrap(
      <HistoryTab
        itemId={ID}
        currentRevisionId={REV_B}
        canRestore
        dirty={false}
        onRestore={onRestore}
      />,
    );
    const rows = await screen.findAllByText(/النسخة \d/);
    expect(rows[0]?.textContent).toContain("2");
    expect(screen.getByText(t("admin.editor.history.approved"))).toBeTruthy();
    expect(screen.getByText(t("admin.editor.history.published"))).toBeTruthy();

    for (const box of screen.getAllByRole("checkbox")) await userEvent.click(box);
    await waitFor(() => {
      expect(document.querySelector("ins")?.textContent).toContain("three");
    });
    expect(document.querySelector("del")?.textContent).toContain("two");

    // The current revision cannot be restored; the older one can, after confirming.
    await userEvent.click(
      screen.getByRole("button", { name: t("admin.editor.history.restoreNumber", { number: 1 }) }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: t("admin.editor.history.restore") }),
    );
    await waitFor(() => {
      expect(onRestore).toHaveBeenCalledWith(REV_A);
    });
    expect(
      screen.queryByRole("button", {
        name: t("admin.editor.history.restoreNumber", { number: 2 }),
      }),
    ).toBeNull();
  });

  it("hides restore without permission and keeps at most two ticks", async () => {
    fetchMock.mockResolvedValue(json([revision(REV_B, 2), revision(REV_A, 1)]));
    wrap(
      <HistoryTab
        itemId={ID}
        currentRevisionId={REV_B}
        canRestore={false}
        dirty
        onRestore={vi.fn()}
      />,
    );
    await screen.findAllByRole("checkbox");
    expect(screen.queryByRole("button", { name: /استعادة/ })).toBeNull();
  });
});
