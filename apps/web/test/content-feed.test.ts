import { describe, expect, it, vi } from "vitest";

import { card } from "./support/content-fixtures";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MEDIA_ORIGIN = "https://media.test/bucket";
});
vi.mock("server-only", () => ({}));

const { buildRss } = await import("../src/lib/content-feed");

const SITE = "https://wasfa.online";

describe("buildRss", () => {
  it("builds an escaped RSS 2.0 document", () => {
    const xml = buildRss({ locale: "ar", items: [card()], siteUrl: SITE });
    expect(xml).toMatchInlineSnapshot(
      `"<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>وصفة AI - المدونة</title><link>https://wasfa.online/blog</link><description>وصفة AI مساعد طبي ذكي بالعربية: ارفع صورة الروشتة المكتوبة بخط اليد أو المطبوعة واحصل على تحليل واضح لأسماء الأدوية والجرعات والتحذيرات.</description><language>ar</language><lastBuildDate>Mon, 05 Oct 2026 08:00:00 GMT</lastBuildDate><atom:link href="https://wasfa.online/blog/feed.xml" rel="self" type="application/rss+xml"/><item><title>Reading &lt;a&gt; prescription &amp; more</title><link>https://wasfa.online/blog/reading-a-prescription</link><guid isPermaLink="true">https://wasfa.online/blog/reading-a-prescription</guid><pubDate>Thu, 01 Oct 2026 08:00:00 GMT</pubDate><dc:creator>Dr. Sara</dc:creator><category>Basics</category><description>How to read it.</description><content:encoded><![CDATA[<p>How to read it.</p>]]></content:encoded><enclosure url="https://media.test/bucket/media/abc/1280.webp" length="60000" type="image/webp"/><media:thumbnail url="https://media.test/bucket/media/abc/640.webp" width="640"/></item></channel></rss>"`,
    );
  });

  it("uses english channel data and an absolute self link", () => {
    const xml = buildRss({
      locale: "en",
      items: [card({ locale: "en", path: "/en/blog/x", image: null, author: null })],
      siteUrl: SITE,
    });
    expect(xml).toContain('<atom:link href="https://wasfa.online/en/blog/feed.xml" rel="self"');
    expect(xml).toContain("<language>en</language>");
    expect(xml).toContain('<guid isPermaLink="true">https://wasfa.online/en/blog/x</guid>');
    expect(xml).not.toContain("<enclosure");
    expect(xml).not.toContain("<dc:creator>");
  });

  it("caps at 50 items and handles an empty feed", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      card({ slug: `s${String(i)}`, path: `/blog/s${String(i)}` }),
    );
    expect(buildRss({ locale: "ar", items: many, siteUrl: SITE }).match(/<item>/g)).toHaveLength(
      50,
    );
    const empty = buildRss({ locale: "ar", items: [], siteUrl: SITE });
    expect(empty).not.toContain("<item>");
    expect(empty).not.toContain("<lastBuildDate>");
  });
});
