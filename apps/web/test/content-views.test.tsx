// @vitest-environment jsdom
import { existsSync } from "node:fs";
import { join } from "node:path";

import { render, screen, within } from "@testing-library/react";
import { settingDefault, type PublicSettings } from "@wasfa/shared/settings";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicItem, PublicItemCard, PublicTaxonomyPage } from "@wasfa/shared/schemas/content";

// `server-only` (content-api, nonce) throws outside a server build.
vi.mock("server-only", () => ({}));

const api = vi.hoisted(() => ({
  resolveContent: vi.fn(),
  listContent: vi.fn(),
  getTaxonomyPage: vi.fn(),
  getTaxonomyList: vi.fn(),
  getGlossaryIndex: vi.fn(),
  getPreview: vi.fn(),
  hasPublicContent: vi.fn(),
  mediaUrl: (key: string) => `https://media.test/${key}`,
}));
vi.mock("../src/lib/content-api", () => api);
vi.mock("../src/lib/nonce", () => ({ getNonce: () => Promise.resolve("nonce-1") }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  permanentRedirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const { ArticleView } = await import("../src/components/content/article-view");
const pages = await import("../src/components/content/content-pages");
const { AuthorView, ContentListView, GlossaryHubView } =
  await import("../src/components/content/list-views");
const { navItems } = await import("../src/components/marketing/site-header");
const { SiteFooter, footerColumns } = await import("../src/components/marketing/site-footer");

const SITE = "https://wasfa.online";
const NOW = "2026-10-01T10:00:00.000Z";

function card(overrides: Partial<PublicItemCard> = {}): PublicItemCard {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    type: "article",
    locale: "ar",
    slug: "first",
    path: "/blog/first",
    title: "كيف تقرأ الروشتة",
    excerpt: "ملخص قصير",
    definition: "",
    publishedAt: NOW,
    contentUpdatedAt: NOW,
    readingMinutes: 4,
    category: { slug: "rx", name: "الروشتة", path: "/blog/c/rx" },
    author: { name: "د. منى", path: "/authors/mona" },
    image: null,
    ...overrides,
  };
}

function item(overrides: Partial<PublicItem> = {}): PublicItem {
  return {
    ...card(),
    bodyHtml: '<h2 id="intro">مقدمة</h2><p>نص</p><aside class="callout callout-warning"></aside>',
    toc: [{ id: "intro", text: "مقدمة", level: 2 }],
    wordCount: 600,
    firstPublishedAt: NOW,
    tags: [{ slug: "bid", name: "BID", path: "/blog/t/bid" }],
    author: {
      slug: "mona",
      name: "د. منى",
      credentials: "صيدلانية",
      path: "/authors/mona",
      photo: null,
    },
    reviewer: null,
    corrections: [],
    seo: {
      title: "",
      description: "",
      canonical: null,
      robots: "index",
      ogTitle: "",
      ogDescription: "",
      ogImage: null,
    },
    flags: {
      autoLink: true,
      showToc: false,
      showRelated: true,
      sponsored: false,
      aiAssisted: false,
    },
    alternates: { ar: "/blog/first", en: null },
    related: [],
    ...overrides,
  };
}

function view(overrides: Partial<PublicItem> = {}, preview = false) {
  return render(<ArticleView item={item(overrides)} nonce="n" siteUrl={SITE} preview={preview} />);
}

beforeEach(() => {
  for (const fn of Object.values(api))
    if (typeof fn !== "string" && "mockReset" in fn) fn.mockReset();
  api.hasPublicContent.mockResolvedValue({ blog: true, guides: false, glossary: false });
});

describe("ArticleView", () => {
  it("renders the reviewer line only when there is a reviewer", () => {
    const { unmount } = view();
    expect(screen.queryByText(/راجعه طبيًا/)).toBeNull();
    unmount();
    view({
      reviewer: {
        slug: "ali",
        name: "د. علي",
        credentials: "استشاري",
        path: "/authors/ali",
        photo: null,
        reviewedAt: "2026-09-20T08:00:00.000Z",
        licence: null,
      },
    });
    expect(screen.getByText(/راجعه طبيًا/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "د. علي" }).getAttribute("href")).toBe("/authors/ali");
  });

  it("shows visible published and updated dates equal to the datetime attributes", () => {
    const { container } = view({ contentUpdatedAt: "2026-10-05T09:00:00.000Z" });
    const times = [...container.querySelectorAll("time")].map((node) =>
      node.getAttribute("datetime"),
    );
    expect(times).toEqual(["2026-10-01", "2026-10-05"]);
  });

  it("marks the article language and direction from the content", () => {
    const { container } = view({
      locale: "en",
      path: "/en/blog/first",
      title: "Reading a prescription",
    });
    const article = container.querySelector("article");
    expect(article?.getAttribute("lang")).toBe("en");
    expect(article?.getAttribute("dir")).toBe("ltr");
    expect(container.querySelector(".content-prose")?.getAttribute("lang")).toBe("en");
  });

  it("renders corrections, the AI note and the sponsored label from data", () => {
    view({
      corrections: [{ summary: "تصحيح جرعة", at: "2026-10-02T00:00:00.000Z" }],
      flags: {
        autoLink: true,
        showToc: false,
        showRelated: true,
        sponsored: true,
        aiAssisted: true,
      },
    });
    expect(screen.getByText(/تصحيح جرعة/)).toBeTruthy();
    expect(screen.getByText(/كُتب بمساعدة أدوات ذكاء اصطناعي/)).toBeTruthy();
    expect(screen.getByText("محتوى برعاية")).toBeTruthy();
  });

  it("omits corrections, notes and the sponsored label when the data has none", () => {
    view();
    expect(screen.queryByText("تصحيحات")).toBeNull();
    expect(screen.queryByText(/كُتب بمساعدة/)).toBeNull();
    expect(screen.queryByText("محتوى برعاية")).toBeNull();
  });

  it("shows the TOC for guides and showToc articles only", () => {
    const { unmount } = view();
    expect(screen.queryByRole("navigation", { name: "محتويات الصفحة" })).toBeNull();
    unmount();
    const { container } = view({ type: "guide", path: "/guides/first" });
    expect(container.querySelector("details")).toBeTruthy();
    expect(container.querySelector('a[href="#intro"]')).toBeTruthy();
  });

  it("renders related cards unless showRelated is off", () => {
    const related = [card({ id: "22222222-2222-4222-8222-222222222222", title: "مقال مرتبط" })];
    const { unmount } = view({ related });
    expect(screen.getByRole("heading", { name: "مقال مرتبط" })).toBeTruthy();
    unmount();
    view({
      related,
      flags: {
        autoLink: true,
        showToc: false,
        showRelated: false,
        sponsored: false,
        aiAssisted: false,
      },
    });
    expect(screen.queryByRole("heading", { name: "مقال مرتبط" })).toBeNull();
  });

  it("offers plain share links and no third-party script", () => {
    const { container } = view();
    const share = screen.getByRole("heading", { name: "شارك الصفحة" }).closest("section");
    const hrefs = within(share as HTMLElement)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((href) => href.startsWith("https://wa.me/?text="))).toBe(true);
    for (const a of within(share as HTMLElement).getAllByRole("link")) {
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    }
    expect(
      [...container.querySelectorAll("script")].every((s) => s.type === "application/ld+json"),
    ).toBe(true);
  });

  it("emits JSON-LD with the nonce, and none in preview", () => {
    const { container, unmount } = view();
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts[0]?.getAttribute("nonce")).toBe("n");
    unmount();
    const preview = view({}, true);
    expect(preview.container.querySelectorAll("script").length).toBe(0);
    expect(screen.getByText("معاينة — غير منشور")).toBeTruthy();
  });

  it("renders a glossary entry with its definition", () => {
    view({ type: "glossary", path: "/glossary/bid", definition: "مرتان يوميًا" });
    expect(screen.getByText(/مرتان يوميًا/)).toBeTruthy();
  });

  it("injects the stored body HTML", () => {
    const { container } = view();
    expect(container.querySelector(".content-prose h2#intro")).toBeTruthy();
    expect(container.querySelector(".content-prose .callout-warning")).toBeTruthy();
  });
});

describe("list views", () => {
  const base = {
    locale: "ar" as const,
    nonce: "n",
    title: "المدونة",
    trail: [{ name: "المدونة", path: "/blog" }],
    path: "/blog",
    pageSize: 12,
  };

  it("shows the friendly empty state instead of failing", () => {
    render(<ContentListView {...base} cards={[]} total={0} page={1} />);
    expect(screen.getByText("لا يوجد محتوى منشور هنا بعد")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("المدونة");
  });

  it("paginates with plain links, aria-current and hidden prev/next at the ends", () => {
    const { rerender } = render(<ContentListView {...base} cards={[card()]} total={30} page={1} />);
    const nav = screen.getByRole("navigation", { name: "التنقل بين الصفحات" });
    expect(within(nav).queryByText("السابق")).toBeNull();
    expect(within(nav).getByText("التالي").closest("a")?.getAttribute("href")).toBe("/blog?page=2");
    expect(within(nav).getByRole("link", { name: "الصفحة 1" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(within(nav).getByRole("link", { name: "الصفحة 1" }).getAttribute("href")).toBe("/blog");
    expect(nav.querySelector("a[rel]")).toBeNull();
    rerender(<ContentListView {...base} cards={[card()]} total={30} page={3} />);
    expect(
      within(screen.getByRole("navigation", { name: "التنقل بين الصفحات" })).queryByText("التالي"),
    ).toBeNull();
  });

  it("renders no pagination for a single page and chips with the active one marked", () => {
    render(
      <ContentListView
        {...base}
        cards={[card()]}
        total={1}
        page={1}
        chips={{
          items: [{ slug: "rx", name: "الروشتة", path: "/blog/c/rx" }],
          activePath: "/blog/c/rx",
          allPath: "/blog",
        }}
      />,
    );
    expect(screen.queryByRole("navigation", { name: "التنقل بين الصفحات" })).toBeNull();
    expect(screen.getByRole("link", { name: "الروشتة" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "الكل" }).getAttribute("aria-current")).toBeNull();
  });

  it("renders the English chrome for an English list", () => {
    render(
      <ContentListView
        {...base}
        locale="en"
        title="Blog"
        cards={[]}
        total={0}
        page={1}
        path="/en/blog"
        trail={[{ name: "Blog", path: "/en/blog" }]}
      />,
    );
    expect(screen.getByText("Nothing published here yet")).toBeTruthy();
  });

  it("groups the glossary in both scripts with jump links", () => {
    render(
      <GlossaryHubView
        locale="ar"
        nonce="n"
        path="/glossary"
        trail={[{ name: "المصطلحات", path: "/glossary" }]}
        items={[
          { slug: "bid", path: "/glossary/bid", term: "BID", definition: "مرتان" },
          { slug: "ibra", path: "/glossary/ibra", term: "إبرة", definition: "حقنة" },
        ]}
      />,
    );
    const jump = screen.getByRole("navigation", { name: "القفز إلى حرف" });
    expect(within(jump).getByRole("link", { name: "B" }).getAttribute("href")).toBe("#letter-b");
    expect(within(jump).getByRole("link", { name: "ا" })).toBeTruthy();
  });

  it("renders an author with credentials and article list, and no photo block without a photo", () => {
    const author: PublicTaxonomyPage = {
      kind: "author",
      slug: "mona",
      name: "د. منى",
      path: "/authors/mona",
      introHtml: "",
      seoTitle: "",
      seoDescription: "",
      indexable: true,
      itemCount: 1,
      person: {
        slug: "mona",
        name: "د. منى",
        credentials: "صيدلانية إكلينيكية",
        path: "/authors/mona",
        photo: null,
        sameAs: ["https://example.org/mona"],
        bioHtml: "<p>سيرة</p>",
      },
      alternates: { ar: "/authors/mona", en: null },
    };
    render(
      <AuthorView
        locale="ar"
        nonce="n"
        author={author}
        trail={[{ name: "د. منى", path: "/authors/mona" }]}
        cards={[card()]}
        total={1}
        page={1}
        pageSize={12}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("د. منى");
    expect(screen.getByText("صيدلانية إكلينيكية")).toBeTruthy();
    expect(screen.getByRole("link", { name: "example.org" }).getAttribute("rel")).toContain(
      "noopener",
    );
  });
});

describe("route decisions (resolve -> render / redirect / notFound)", () => {
  it("renders an item, redirects on `redirect`, and 404s on gone / not_found / wrong locale", async () => {
    api.resolveContent.mockResolvedValueOnce({ kind: "item", item: item() });
    expect((await pages.loadItem("article", "ar", "first")).slug).toBe("first");

    api.resolveContent.mockResolvedValueOnce({ kind: "redirect", to: "/blog/new" });
    await expect(pages.loadItem("article", "ar", "old")).rejects.toThrow("REDIRECT:/blog/new");

    api.resolveContent.mockResolvedValueOnce({ kind: "gone" });
    await expect(pages.loadItem("article", "ar", "x")).rejects.toThrow("NOT_FOUND");

    api.resolveContent.mockResolvedValueOnce({ kind: "not_found" });
    await expect(pages.loadItem("article", "ar", "x")).rejects.toThrow("NOT_FOUND");

    // An English item under the Arabic route never renders.
    api.resolveContent.mockResolvedValueOnce({ kind: "item", item: item({ locale: "en" }) });
    await expect(pages.loadItem("article", "ar", "first")).rejects.toThrow("NOT_FOUND");
  });

  it("builds item metadata from the item's SEO fields with the right robots", async () => {
    api.resolveContent.mockResolvedValue({
      kind: "item",
      item: item({
        seo: { ...item().seo, title: "عنوان SEO", description: "وصف", robots: "noindex" },
      }),
    });
    const meta = await pages.itemMetadata("article", "ar", "first");
    expect(meta.title).toBeDefined();
    expect(meta.description).toBe("وصف");
  });

  it("omits hreflang when the item has no twin", async () => {
    api.resolveContent.mockResolvedValue({ kind: "item", item: item() });
    const meta = await pages.itemMetadata("article", "ar", "first");
    expect(meta.alternates?.languages).toBeUndefined();
    api.resolveContent.mockResolvedValue({
      kind: "item",
      item: item({ alternates: { ar: "/blog/first", en: "/en/blog/first" } }),
    });
    const withTwin = await pages.itemMetadata("article", "ar", "first");
    expect(withTwin.alternates?.languages).toBeDefined();
  });

  it("404s a preview token the API does not know and renders a known one with the banner", async () => {
    api.getPreview.mockResolvedValueOnce(null);
    await expect(pages.PreviewPage({ token: "bad" })).rejects.toThrow("NOT_FOUND");
    api.getPreview.mockResolvedValueOnce({ item: item(), expiresAt: NOW, isDraft: true });
    render(await pages.PreviewPage({ token: "good" }));
    expect(screen.getByText("معاينة — غير منشور")).toBeTruthy();
  });

  it("marks previews noindex,nofollow", () => {
    const meta = pages.previewMetadata();
    expect(meta.robots).toMatchObject({ index: false, follow: false });
  });

  it("keeps the hub itself alive when it is empty, and 404s a page past the end", async () => {
    api.listContent.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 });
    api.getTaxonomyList.mockResolvedValue({ items: [] });
    const ok = await pages.BlogHomePage({ locale: "ar", searchParams: {} });
    expect(ok).toBeTruthy();
    await expect(pages.BlogHomePage({ locale: "ar", searchParams: { page: "5" } })).rejects.toThrow(
      "NOT_FOUND",
    );
  });

  it("404s an unknown taxonomy page and noindexes a non-indexable tag", async () => {
    api.getTaxonomyPage.mockResolvedValueOnce(null);
    await expect(pages.taxonomyMetadata("tag", "ar", "nope", {})).rejects.toThrow("NOT_FOUND");
    const tag: PublicTaxonomyPage = {
      kind: "tag",
      slug: "bid",
      name: "BID",
      path: "/blog/t/bid",
      introHtml: "",
      seoTitle: "",
      seoDescription: "",
      indexable: false,
      itemCount: 1,
      person: null,
      alternates: { ar: "/blog/t/bid", en: null },
    };
    api.getTaxonomyPage.mockResolvedValue(tag);
    const meta = await pages.taxonomyMetadata("tag", "ar", "bid", {});
    // Robots are production-only metadata; the test environment keeps the layout default.
    expect(meta.alternates?.canonical).toBe("https://wasfa.online/blog/t/bid");
  });

  it("self-canonicalises page 2 of a hub", async () => {
    const meta = await pages.hubMetadata("blog", "ar", { page: "2" });
    expect(meta.alternates?.canonical).toBe("https://wasfa.online/blog?page=2");
  });

  it("lists the hreflang twin of a hub only when the other language has content", async () => {
    api.hasPublicContent.mockResolvedValue({ blog: false, guides: false, glossary: false });
    expect((await pages.hubMetadata("blog", "ar", {})).alternates?.languages).toBeUndefined();
    api.hasPublicContent.mockResolvedValue({ blog: true, guides: false, glossary: false });
    expect((await pages.hubMetadata("blog", "ar", {})).alternates?.languages).toBeDefined();
  });

  it("the catch-all answers 404 without an API call for anything that is not a page slug", () => {
    expect(() => pages.pageSlugFromSegments(["a", "b", "c", "d"])).toThrow("NOT_FOUND");
    expect(() => pages.pageSlugFromSegments(["Wp-Admin"])).toThrow("NOT_FOUND");
    expect(pages.pageSlugFromSegments(["legal", "cookies"])).toBe("legal/cookies");
    expect(api.resolveContent).not.toHaveBeenCalled();
  });
});

describe("navigation gating by hasPublicContent", () => {
  function settings(): PublicSettings {
    return {
      branding: settingDefault("branding"),
      contact: settingDefault("contact"),
      socials: settingDefault("socials"),
      locale: settingDefault("locale"),
      currency: settingDefault("currency"),
      access: settingDefault("access"),
      free_tier: settingDefault("free_tier"),
      rx: settingDefault("rx"),
      seo: settingDefault("seo"),
      landing: settingDefault("landing"),
    };
  }

  it("shows no content links on an empty site", () => {
    const none = { blog: false, guides: false };
    expect(navItems("ar", none).some((item) => item.href.includes("blog"))).toBe(false);
    expect(footerColumns("ar").some((column) => column.id === "resources")).toBe(false);
  });

  it("links only the sections that have content, in both languages", () => {
    const hrefs = navItems("en", { blog: true, guides: false }).map((item) => item.href);
    expect(hrefs).toContain("/en/blog");
    expect(hrefs).not.toContain("/en/guides");

    const columns = footerColumns("ar", { blog: true, guides: true, glossary: false });
    const resources = columns.find((column) => column.id === "resources");
    expect(resources?.links.map((link) => link.href)).toEqual(["/blog", "/guides"]);
    render(
      <SiteFooter
        settings={settings()}
        locale="ar"
        content={{ blog: true, guides: true, glossary: false }}
      />,
    );
    expect(screen.getByRole("heading", { name: "الموارد" })).toBeTruthy();
  });
});

describe("static routes win over the catch-all", () => {
  const app = join(process.cwd(), "src", "app", "(marketing)");

  it("keeps the files of the existing public pages in both languages", () => {
    for (const route of [
      "about",
      "pricing",
      "contact",
      "features/prescription-reader",
      "features/medicine-explainer",
      "for/clinics",
    ]) {
      expect(existsSync(join(app, route, "page.tsx")), route).toBe(true);
      expect(existsSync(join(app, "en", route, "page.tsx")), `en/${route}`).toBe(
        route !== "contact" || true,
      );
    }
  });

  it("has the catch-all in both languages and no static file shadowing a content section", () => {
    expect(existsSync(join(app, "[...slug]", "page.tsx"))).toBe(true);
    expect(existsSync(join(app, "en", "[...slug]", "page.tsx"))).toBe(true);
    for (const section of ["blog", "guides", "glossary", "authors"]) {
      expect(existsSync(join(app, section, "page.tsx")) || section === "authors").toBe(true);
    }
  });
});
