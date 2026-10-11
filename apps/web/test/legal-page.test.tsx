// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { t } from "@wasfa/shared/i18n";
import { describe, expect, it } from "vitest";

import { LegalPage } from "../src/components/marketing/legal-page";
import { disclaimer } from "../src/content/legal/disclaimer";
import { privacy } from "../src/content/legal/privacy";
import { terms } from "../src/content/legal/terms";

import type { LegalDoc } from "../src/content/legal/types";

/** Every text of a document, to check what the policy says without caring where. */
function allText(doc: LegalDoc): string {
  return JSON.stringify(doc);
}

describe.each([
  ["privacy", privacy],
  ["terms", terms],
  ["disclaimer", disclaimer],
])("LegalPage (%s)", (_name, doc) => {
  it("has one h1, the last-updated date and the draft notice before the text", () => {
    render(<LegalPage doc={doc} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(doc.title);

    const notice = screen.getByText(t("marketing.legal.draft"));
    expect(notice.closest("[role=status]")).toBeTruthy();
    // The draft notice comes before the intro and the table of contents.
    const intro = screen.getByText(doc.intro);
    expect(notice.compareDocumentPosition(intro) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/آخر تحديث/)).toBeTruthy();
  });

  it("links every section from the table of contents to its anchor", () => {
    const { container } = render(<LegalPage doc={doc} />);
    const toc = within(screen.getByRole("navigation", { name: t("marketing.legal.toc") }));
    for (const section of doc.sections) {
      const link = toc.getByRole("link", { name: section.title });
      expect(link.getAttribute("href")).toBe(`#${section.id}`);
      expect(container.querySelector(`#${section.id}`)).toBeTruthy();
    }
  });
});

describe("privacy policy content", () => {
  const text = allText(privacy);

  it("cites the Egyptian law and the KSA and UAE PDPL", () => {
    expect(text).toContain("151 لسنة 2020");
    expect(text).toContain("المملكة العربية السعودية");
    expect(text).toContain("45 لسنة 2021");
  });

  it("states the retention rules: 14 days to anonymization, 7 days for never-verified accounts", () => {
    expect(text).toContain("14 يومًا");
    expect(text).toContain("7 أيام");
  });

  it("covers every data category of the inventory with what, why and retention", () => {
    const data = privacy.sections
      .flatMap((section) => section.blocks)
      .filter((block) => block.type === "dataList")
      .flatMap((block) => block.items);
    expect(data.map((item) => item.title)).toEqual([
      "البريد الإلكتروني",
      "رقم الهاتف",
      "الاسم وبيانات الملف الشخصي",
      "بيانات الدخول والمصادقة",
      "عنوان IP ومعلومات الجهاز",
      "رسائل التواصل",
      "سجلات الأخطاء التقنية",
    ]);
    for (const item of data) {
      expect(item.what).not.toBe("");
      expect(item.why).not.toBe("");
      expect(item.retention).not.toBe("");
    }
  });
});
