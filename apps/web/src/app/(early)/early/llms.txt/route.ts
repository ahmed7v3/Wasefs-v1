import { ARAB_COUNTRIES } from "@wasfa/shared/schemas/early-access";

import { early } from "../../../../content/early";
import { EARLY_ORIGIN } from "../../../../lib/early-host";

/** `llms.txt` for the pre-launch subdomain (GEO): what the product is, answer-first, plus the FAQ. */
export function GET(): Response {
  const countries = ARAB_COUNTRIES.map((country) => country.nameAr).join("، ");
  const lines = [
    `# ${early.brand} (Wasfa AI)`,
    "",
    `> ${early.meta.description}`,
    "",
    "## ما هو وصفة AI؟",
    early.faq.items[0]?.answer ?? "",
    "",
    "## الحالة",
    "قائمة انتظار ما قبل الإطلاق. الحجز مجاني، وتطبيقات Android وiOS قريبًا، والخدمة تعمل على واتساب والويب.",
    "",
    "## الدول",
    countries,
    "",
    "## روابط",
    `- [الصفحة الرئيسية](${EARLY_ORIGIN}/)`,
    `- [الخصوصية](${EARLY_ORIGIN}/privacy)`,
    "",
    "## الأسئلة الشائعة",
    ...early.faq.items.flatMap((item) => [`### ${item.question}`, item.answer, ""]),
    "## تنبيه",
    early.footer.disclaimer,
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
