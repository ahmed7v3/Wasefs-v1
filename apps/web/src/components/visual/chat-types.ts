export type ChatMedItem = {
  name: string;
  /** Dose / schedule chips, e.g. "500 مجم", "كل 8 ساعات", "بعد الأكل". */
  chips: readonly string[];
};

export type ChatMessage =
  | { id: string; from: "user" | "bot"; kind: "text"; text: string }
  | { id: string; from: "bot"; kind: "meds"; title?: string; items: readonly ChatMedItem[] };
