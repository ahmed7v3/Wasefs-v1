/** Shape shared by the three legal documents; the legal page component renders it. */

export type LegalBlock =
  | { type: "p"; text: string }
  | { type: "ul"; items: readonly string[] }
  /** One data category per item; rendered as cards so it reads on a 360 px screen (no wide table). */
  | { type: "dataList"; items: readonly LegalDataItem[] };

export interface LegalDataItem {
  title: string;
  what: string;
  why: string;
  retention: string;
}

export interface LegalSection {
  /** Anchor id and table-of-contents target. */
  id: string;
  title: string;
  blocks: readonly LegalBlock[];
}

export interface LegalDoc {
  title: string;
  /** Meta description of the page. */
  description: string;
  /** ISO date (UTC) of the last edit of the text. */
  updated: string;
  intro: string;
  sections: readonly LegalSection[];
}

/** Labels of a `dataList` item, shared so the three columns read the same everywhere. */
export const DATA_LIST_LABELS = {
  what: "ما الذي نحفظه",
  why: "لماذا",
  retention: "مدة الاحتفاظ",
} as const;
