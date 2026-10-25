import { settingDefault } from "@wasfa/shared/settings";
import { describe, expect, it, vi } from "vitest";

import {
  ContentRenderService,
  normalizeInternalPath,
  type RenderSubject,
} from "../src/content/content-render.service.js";

import type { ContentItemsRepo } from "../src/content/items.repo.js";
import type { SettingsService } from "../src/settings/settings.service.js";
import type { QualityGate } from "@wasfa/shared/schemas/content";

const BODY = Array.from(
  { length: 40 },
  (_, i) => `الجملة رقم ${String(i)} تشرح موضوعا طبيا مختلفا بتفصيل كاف للقارئ`,
).join(" ");

function subject(overrides: Partial<RenderSubject> = {}, bodyMd = BODY): RenderSubject {
  return {
    itemId: null,
    translationGroupId: null,
    type: "article",
    locale: "ar",
    payload: { title: "عنوان المقال", excerpt: "ملخص", definition: "", bodyMd },
    meta: {
      slug: "a",
      categoryId: null,
      primaryAuthorId: null,
      reviewerId: null,
      featuredMediaId: null,
      seo: {
        title: "",
        description: "وصف",
        canonical: "",
        robots: "index",
        focusKeyword: "",
        secondaryKeywords: [],
        ogTitle: "",
        ogDescription: "",
        ogImageMediaId: null,
      },
      flags: {
        autoLink: true,
        showToc: false,
        showRelated: true,
        sponsored: false,
        aiAssisted: false,
      },
    },
    categoryRequiresReview: true,
    approvedMatchesCurrent: false,
    ...overrides,
  };
}

function setup(repoOverrides: Record<string, unknown> = {}, env: Record<string, unknown> = {}) {
  const repo = {
    glossaryTargets: vi.fn(() => Promise.resolve([])),
    findPublishedGlossary: vi.fn(() => Promise.resolve(undefined)),
    readyMedia: vi.fn(() => Promise.resolve([])),
    publishedMinhashes: vi.fn(() => Promise.resolve([])),
    similarTitleExists: vi.fn(() => Promise.resolve(false)),
    publishedDescriptions: vi.fn(() => Promise.resolve([] as string[])),
    internalPathState: vi.fn<
      (paths: string[]) => Promise<{ items: Map<string, string>; redirected: Set<string> }>
    >(() => Promise.resolve({ items: new Map(), redirected: new Set() })),
    ...repoOverrides,
  };
  const settings = { get: vi.fn(() => Promise.resolve(settingDefault("content"))) };
  const service = new ContentRenderService(
    repo as unknown as ContentItemsRepo,
    settings as unknown as SettingsService,
    { MEDIA_PUBLIC_ORIGIN: "https://media.example.com", ...env } as never,
  );
  return { service, repo };
}

const gate = (gates: QualityGate[], id: QualityGate["id"]) => gates.find((g) => g.id === id);

describe("normalizeInternalPath", () => {
  it("drops query, fragment and trailing slash", () => {
    expect(normalizeInternalPath("/blog/x/?a=1#top")).toBe("/blog/x");
    expect(normalizeInternalPath("/")).toBe("/");
  });
});

describe("similarity gate", () => {
  it("blocks a copy of a published item and names its path", async () => {
    const first = await setup().service.build(subject());
    const { service } = setup({
      publishedMinhashes: vi.fn(() =>
        Promise.resolve([
          { type: "article", locale: "ar", slug: "original", minhash: first.render.minhash },
        ]),
      ),
    });
    const built = await service.build(subject());
    const duplicate = gate(built.gates, "duplicate_content");
    expect(duplicate).toMatchObject({ level: "block", ok: false });
    expect(duplicate?.params).toMatchObject({ score: 1, matchPath: "/blog/original" });
  });

  it("only warns between the thresholds", async () => {
    const first = await setup().service.build(subject());
    const partial = new Uint8Array(first.render.minhash);
    // Change 60 of the 128 values: about 0.53 agreement, between warnAt 0.4 and blockAt 0.6.
    for (let i = 0; i < 60 * 4; i += 1) partial[i] = (partial[i] ?? 0) ^ 0xff;
    const { service } = setup({
      publishedMinhashes: vi.fn(() =>
        Promise.resolve([{ type: "article", locale: "ar", slug: "similar", minhash: partial }]),
      ),
    });
    const duplicate = gate((await service.build(subject())).gates, "duplicate_content");
    expect(duplicate).toMatchObject({ level: "warn", ok: false });
  });

  it("passes with nothing to compare against and excludes the own translation group", async () => {
    const { service, repo } = setup();
    const built = await service.build(subject({ translationGroupId: "g1" }));
    expect(gate(built.gates, "duplicate_content")?.ok).toBe(true);
    expect(repo.publishedMinhashes).toHaveBeenCalledWith("ar", "g1", 5000);
  });
});

describe("duplicate title and description", () => {
  it("flags a near-identical published title with the configured threshold", async () => {
    const { service, repo } = setup({ similarTitleExists: vi.fn(() => Promise.resolve(true)) });
    const built = await service.build(subject());
    expect(gate(built.gates, "title_unique")).toMatchObject({ level: "block", ok: false });
    expect(repo.similarTitleExists).toHaveBeenCalledWith(
      expect.objectContaining({ threshold: 0.9, type: "article", locale: "ar" }),
    );
  });

  it("flags an equal meta description after normalisation", async () => {
    const { service } = setup({
      publishedDescriptions: vi.fn(() => Promise.resolve(["وصف"])),
    });
    expect(gate((await service.build(subject())).gates, "description_unique")?.ok).toBe(false);
  });
});

describe("broken internal links", () => {
  const body = `${BODY}\n\n[good](/blog/live) [moved](/blog/old#x) [gone](/blog/missing) [tool](/analyze) [out](https://who.int/x)`;

  it("counts content links that are neither live nor redirected, and ignores other routes", async () => {
    const { service, repo } = setup({
      internalPathState: vi.fn((paths: string[]) =>
        Promise.resolve({
          items: new Map(paths.filter((p) => p === "/blog/live").map((p) => [p, "item-1"])),
          redirected: new Set(paths.filter((p) => p === "/blog/old")),
        }),
      ),
    });
    const built = await service.build(subject({}, body));
    expect(repo.internalPathState).toHaveBeenCalledWith(
      expect.arrayContaining(["/blog/live", "/blog/old", "/blog/missing"]),
    );
    expect(repo.internalPathState.mock.calls[0]?.[0]).not.toContain("/analyze");
    expect(gate(built.gates, "broken_links")).toMatchObject({ ok: false, params: { count: 1 } });
    const live = built.links.find((link) => link.href === "/blog/live");
    expect(live).toMatchObject({ kind: "internal", targetItemId: "item-1" });
    expect(built.links.find((link) => link.href.startsWith("https://"))).toMatchObject({
      kind: "external",
      host: "who.int",
    });
  });
});

describe("review gate and derived fields", () => {
  it("requires the approval to match the revision for reviewed content", async () => {
    const { service } = setup();
    const pending = await service.build(subject({ approvedMatchesCurrent: false }));
    expect(gate(pending.gates, "medical_review")).toMatchObject({ level: "block", ok: false });
    const approved = await service.build(subject({ approvedMatchesCurrent: true }));
    expect(gate(approved.gates, "medical_review")?.ok).toBe(true);
    const page = await service.build(subject({ type: "page", categoryRequiresReview: null }));
    expect(gate(page.gates, "medical_review")).toBeUndefined();
  });

  it("returns what the repo stores: 512-byte signature, search text, counts", async () => {
    const built = await setup().service.build(subject());
    expect(built.derived.minhash.byteLength).toBe(512);
    expect(built.derived.wordCount).toBeGreaterThan(100);
    expect(built.searchText).toContain("الجمله");
    expect(built.derived.quality).toBe(built.gates);
  });

  it("keeps the keyword-owner seam open until WP5", async () => {
    const built = await setup().service.build(
      subject({
        meta: { ...subject().meta, seo: { ...subject().meta.seo, focusKeyword: "انفلونزا" } },
      }),
    );
    expect(gate(built.gates, "keyword_ownership")).toMatchObject({ ok: true });
  });
});

describe("preview", () => {
  it("renders without touching the gate facts", async () => {
    const { service, repo } = setup();
    const preview = await service.preview({
      type: "article",
      locale: "ar",
      bodyMd: "## عنوان فرعي\n\nنص",
    });
    expect(preview.html).toContain("<h2");
    expect(preview.toc).toHaveLength(1);
    expect(repo.publishedMinhashes).not.toHaveBeenCalled();
  });

  it("offers published glossary entries to the auto-linker, longest term first as the repo orders them", async () => {
    const { service, repo } = setup({
      glossaryTargets: vi.fn(() =>
        Promise.resolve([{ slug: "bp", title: "ضغط الدم", definition: "تعريف", locale: "ar" }]),
      ),
    });
    const preview = await service.preview({
      type: "article",
      locale: "ar",
      bodyMd: "يرتفع ضغط الدم عند كثير من الناس.",
    });
    expect(repo.glossaryTargets).toHaveBeenCalledWith("ar", null, 500);
    expect(preview.html).toContain('href="/glossary/bp"');
  });
});
