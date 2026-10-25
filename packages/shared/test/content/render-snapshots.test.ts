import { describe, expect, it } from "vitest";

import { renderContent } from "../../src/content/render/index.js";

import { DECORATIVE_ID, MEDIA_ID, renderInput } from "./support/render-support.js";

/*
 * `body_html` snapshots: any change to the stored HTML of these documents must be a deliberate one,
 * because it changes every published page the next time it is re-rendered. Review the .snap diff.
 */

const FIXTURES: Record<string, { md: string; locale: "ar" | "en"; autoLink?: boolean }> = {
  "ar-article-full": {
    locale: "ar",
    autoLink: true,
    md: [
      "# كل ما تحتاج معرفته عن الصداع",
      "",
      "الصداع من أكثر الأسباب شيوع\u064Bا لزيارة الطبيب. يستخدم كثيرون {{drug:paracetamol}} لتخفيف الألم، لكن **الجرعة** تختلف حسب العمر.",
      "",
      "## الأعراض",
      "",
      "- ألم نابض في جانب واحد",
      "- حساسية للضوء",
      "- غثيان",
      "",
      `![قرص دواء](media:${MEDIA_ID} "الجرعة الصحيحة أهم من كثرة الدواء")`,
      "",
      ":::warning",
      "لا تتجاوز الجرعة القصوى اليومية دون استشارة الطبيب.",
      ":::",
      "",
      "### متى تزور الطبيب؟",
      "",
      "راجع الطبيب إذا استمر الصداع أكثر من ثلاثة أيام[^1]. اقرأ أيض\u064Bا [دليل الصداع](/guides/headache-guide) و[منظمة الصحة العالمية](https://www.who.int/news-room).",
      "",
      "{{cta:analyze}}",
      "",
      "[^1]: مصدر: منظمة الصحة العالمية، 2024.",
    ].join("\n"),
  },
  "en-article-full": {
    locale: "en",
    md: [
      "# Understanding headaches",
      "",
      "Headaches are among the most common reasons to see a doctor. Many people take {{drug:ibuprofen}} for relief, but the **dose** depends on age.",
      "",
      "## Symptoms",
      "",
      "1. Throbbing pain on one side",
      "2. Sensitivity to light",
      "3. Nausea",
      "",
      `![A tablet](media:${MEDIA_ID})`,
      "",
      ":::tip",
      "Keep a headache diary to share with your doctor.",
      ":::",
      "",
      "> Always read the leaflet before taking any medicine.",
      "",
      "See [a review](https://pubmed.ncbi.nlm.nih.gov/12345/) and [a blog](https://example.com/post).",
      "",
      "{{cta:analyze}}",
    ].join("\n"),
  },
  "ar-glossary-entry": {
    locale: "ar",
    md: "تعني **{{glossary:bid}}** تناول الدواء مرتين في اليوم. راجع أيض\u064Bا {{glossary:zzz|مصطلح\u064Bا آخر}} و{{nolink:مرتين يوميا}}.",
  },
  "en-guide-with-code-and-table": {
    locale: "en",
    md: [
      "## Dosing table",
      "",
      "| Drug | Adult dose | Max per day |",
      "|:-----|-----------:|:-----------:|",
      "| Paracetamol | 500 mg | 4 g |",
      "| Ibuprofen | 400 mg | 1.2 g |",
      "",
      "### Notes",
      "",
      "Text with ~~old~~ new wording and `inline code`.",
      "",
      "```",
      "dose = weight * 15  # mg",
      "```",
      "",
      "- [ ] not a checkbox",
      "- [x] also not a checkbox",
    ].join("\n"),
  },
  "ar-page-mixed-direction": {
    locale: "ar",
    md: [
      "## جرعات الأطفال",
      "",
      "ي\u064Fعطى Paracetamol للأطفال بجرعة 10-15 mg/kg كل 6 ساعات، ولا تتجاوز 4 جرعات في اليوم (QID).",
      "",
      "1. افحص الوزن",
      "2. احسب الجرعة: `weight × 15 mg`",
      "3. استخدم الأداة المرفقة",
      "",
      `![](media:${DECORATIVE_ID})`,
    ].join("\n"),
  },
  "ar-autolink-limits": {
    locale: "ar",
    autoLink: true,
    md: [
      "يحتوي الدواء على باراسيتامول وهو مسكن، وي\u064Fؤخذ مع الأكل. ويختلف باراسيتامول عن ايبوبروفين في آلية العمل.",
      "",
      "## عن باراسيتامول",
      "",
      "الأسيتامينوفين هو الاسم الآخر. بعد ذلك بكلمات كثيرة جد\u064Bا نذكر ايبوبروفين من جديد " +
        Array.from({ length: 130 }, () => "كلمة").join(" ") +
        " ثم ايبوبروفين وباراسيتامول مرة أخرى.",
    ].join("\n"),
  },
  "en-unsafe-input": {
    locale: "en",
    md: [
      "Click [here](javascript:alert(1)) or [there](https://example.com/?a=1&b=2).",
      "",
      "<script>alert(1)</script>",
      "",
      "![x](https://tracker.example/pixel.gif)",
      "",
      "Plain <b>html</b> and a footnote.[^note]",
      "",
      "[^note]: The note.",
    ].join("\n"),
  },
};

describe("body_html snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(name, async () => {
      const result = await renderContent(
        renderInput(fixture.md, {
          locale: fixture.locale,
          flags: { autoLink: fixture.autoLink === true },
          settings: {
            autoLink: { enabled: true, maxPerTarget: 1, minWordsBetween: 120 },
            dofollowDomains: ["who.int", "nih.gov"],
          },
        }),
      );
      expect(result.html).toMatchSnapshot("html");
      expect({
        toc: result.toc,
        wordCount: result.wordCount,
        readingMinutes: result.readingMinutes,
        links: result.links,
        images: result.images,
        entities: result.entities,
        warnings: result.warnings,
      }).toMatchSnapshot("facts");
    });
  }
});
