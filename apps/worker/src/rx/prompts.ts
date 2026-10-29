import { getSkill } from "@wasfa/ai";
import { RX_SKILL_NAME } from "@wasfa/shared/rx";

import type { ChatMessage, NormalizedMessage } from "@wasfa/ai";
import type { DrugMatchCandidate } from "@wasfa/shared/drugs";

/*
 * Prompt assembly, ordered for provider-side caching (phase2.md, Decision 7c): the stable system
 * prompt, then the skill, then the abbreviation glossary, and only then the variable input. The
 * variable part is wrapped in `<user_data>` blocks, which the skill tells the model to treat as
 * data, never as instructions.
 */

export const RX_SKILL = RX_SKILL_NAME;

const SYSTEM = `You are the reading component of a pharmacy assistant. Follow the skill instructions below exactly. Reply with JSON that matches the provided schema and nothing else.`;

/** Reading aid only: the meaning of an abbreviation is decided by code (rx-normalize), never by the model. */
const GLOSSARY = `## Abbreviations you may see (copy them as written; do not translate them)
- 1x3, 1×3, 3x1, bid, b.i.d, tid, qid, od, qd: how many times a day
- prn: when needed; hs: at bedtime
- ac, ق.أ: before meals; pc, ب.أ: after meals
- x 5 days, لمدة 5 أيام: duration`;

export function systemPrompt(): string {
  return `${SYSTEM}\n\n${getSkill(RX_SKILL).body}\n\n${GLOSSARY}`;
}

export interface PageImage {
  jpeg: Buffer;
}

/** The read step: every page, in order, each inside its own `<user_data>` block. */
export function readMessages(pages: readonly PageImage[]): NormalizedMessage[] {
  return [
    {
      role: "user",
      parts: [
        {
          type: "text",
          text: `Read this prescription. It has ${pages.length} page(s); "page" is the 0-based index of the image in this message.`,
        },
        ...pages.flatMap((page, index): ChatMessage["parts"] => [
          { type: "text", text: `<user_data page="${index}">` },
          { type: "image", mime: "image/jpeg", data: page.jpeg },
          { type: "text", text: "</user_data>" },
        ]),
      ],
    },
  ];
}

export interface DetailsLine {
  /** Index of the line in the result: the answer refers to it. */
  index: number;
  name: string;
  activeIngredient: string | null;
  strength: string | null;
  form: string | null;
}

/**
 * The details step: medicine names only, as text. No image and nothing about the patient goes to
 * the provider. The names come from the reading, so they sit inside a `<user_data>` block.
 */
export function detailsMessages(lines: readonly DetailsLine[]): NormalizedMessage[] {
  const listed = lines
    .map((line) =>
      [
        String(line.index),
        line.name,
        line.activeIngredient ?? "",
        line.strength ?? "",
        line.form ?? "",
      ].join(" | "),
    )
    .join("\n");
  return [
    {
      role: "user",
      parts: [
        {
          type: "text",
          text: `Write the "Details step" of the skill for these medicines, in Arabic. One entry per line, using the same index. Columns: index | name | active ingredient | strength | form.`,
        },
        { type: "text", text: `<user_data>\n${listed}\n</user_data>` },
      ],
    },
  ];
}

export interface VerifyItem {
  /** Index of the line in the extraction: the answer refers to it. */
  index: number;
  crop: Buffer;
  candidates: readonly DrugMatchCandidate[];
  /** Plain-text context from the rest of the prescription (other medicines, the directions). */
  context: readonly string[];
}

/** One-line description of a candidate; the id is what the model answers with. */
function candidateLine(candidate: DrugMatchCandidate): string {
  const parts = [candidate.brandEn, candidate.strengthText, candidate.form].filter(
    (part): part is string => part !== null && part !== "",
  );
  return `- ${candidate.drugId} | ${parts.join(" | ")}`;
}

/** The verify step: each flagged line as a cropped image plus its candidates. */
export function verifyMessages(items: readonly VerifyItem[]): NormalizedMessage[] {
  return [
    {
      role: "user",
      parts: [
        {
          type: "text",
          text: `Re-read these unclear prescription lines. The candidates come from the Egyptian drug list. For each item answer with exactly one of: kind "candidate" with the id of one listed candidate and a "confidence" from 0 to 1, kind "none", kind "other" with the text you read, or kind "unreadable". Choose the candidate whose name is consistent with the visible letters, the length, the strength and the form, and that makes sense with the directions and the other medicines on the prescription. A one-letter or one-word difference from what you see is acceptable for handwriting. Answer "none" only when no candidate is consistent with what is written. Give a confidence of 0.75 or more only when the letters, the strength and the form all agree with the candidate. Never invent a name outside the candidates. Answer "unreadable" only when nothing of the name can be read.`,
        },
        ...items.flatMap((item): ChatMessage["parts"] => [
          { type: "text", text: `<user_data item="${item.index}">` },
          { type: "image", mime: "image/jpeg", data: item.crop },
          {
            type: "text",
            text: item.context.join("\n"),
          },
          {
            type: "text",
            text:
              item.candidates.length === 0
                ? "Candidates: none"
                : `Candidates:\n${item.candidates.map(candidateLine).join("\n")}`,
          },
          { type: "text", text: "</user_data>" },
        ]),
      ],
    },
  ];
}
