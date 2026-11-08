import type { ChatMessage } from "./chat-types";

/** Arabic sample conversation (text only, generic names). The page may pass i18n strings instead. */
export const CHAT_SAMPLE_AR: readonly ChatMessage[] = [
  { id: "u1", from: "user", kind: "text", text: "صورة الروشتة 📄" },
  { id: "b1", from: "bot", kind: "text", text: "تمام! لقيت ٣ أدوية:" },
  {
    id: "b2",
    from: "bot",
    kind: "meds",
    items: [
      { name: "باراسيتامول 500 مجم", chips: ["قرص كل 8 ساعات", "بعد الأكل"] },
      { name: "أموكسيسيلين 500 مجم", chips: ["كبسولة كل 12 ساعة", "7 أيام"] },
      { name: "أوميبرازول 20 مجم", chips: ["كبسولة يوميًا", "قبل الفطار"] },
    ],
  },
  { id: "b3", from: "bot", kind: "text", text: "هفكّرك بالمواعيد ⏰" },
];
