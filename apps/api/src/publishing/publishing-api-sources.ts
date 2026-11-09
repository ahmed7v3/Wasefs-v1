import type { PublishingSource } from "@wasfa/shared/schemas/publishing";

/*
 * Sources of an API article: the integrator sends structured `sources`, the stored body carries them as
 * a references list at the very end ("المصادر / Sources"). Deterministic and idempotent: rendering the
 * same sources twice yields the same body, a re-render replaces the old block instead of stacking, and
 * a body patch that sends no `sources` keeps the block that is already there.
 */

export const SOURCES_HEADING = "## المصادر / Sources";

/** The block is only ever replaced when it is exactly a numbered list: a human's own section is left alone. */
const LIST_LINE = /^\d+\.\s+\S/;

export interface SplitBody {
  main: string;
  /** The rendered block (heading included), or null when the body has none. */
  block: string | null;
}

/** Separates a trailing rendered sources block from the rest of the body. */
export function splitSourcesBlock(bodyMd: string): SplitBody {
  const lines = bodyMd.replace(/\s+$/, "").split("\n");
  let headingAt = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]?.trim() === SOURCES_HEADING) {
      headingAt = index;
      break;
    }
  }
  if (headingAt === -1) return { main: bodyMd, block: null };
  const rest = lines.slice(headingAt + 1).filter((line) => line.trim() !== "");
  if (rest.length === 0 || !rest.every((line) => LIST_LINE.test(line.trim()))) {
    return { main: bodyMd, block: null };
  }
  return {
    main: lines.slice(0, headingAt).join("\n").replace(/\s+$/, ""),
    block: lines.slice(headingAt).join("\n"),
  };
}

/** How many references the body already lists. */
export function countRenderedSources(bodyMd: string): number {
  const { block } = splitSourcesBlock(bodyMd);
  return block === null
    ? 0
    : block.split("\n").filter((line) => LIST_LINE.test(line.trim())).length;
}

const escapeText = (text: string): string => text.replace(/[\\[\]<>*_`]/g, (char) => `\\${char}`);

/** `)` and spaces would end a Markdown link target early. */
const safeUrl = (url: string): string =>
  url.replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");

export function renderSourcesBlock(sources: readonly PublishingSource[]): string {
  const items = sources.map((source, index) => {
    const tail = [
      source.publisher === undefined ? null : escapeText(source.publisher),
      source.accessed_at === undefined ? null : `accessed ${source.accessed_at.slice(0, 10)}`,
    ].filter((part): part is string => part !== null);
    const suffix = tail.length === 0 ? "" : ` — ${tail.join(", ")}`;
    return `${String(index + 1)}. [${escapeText(source.title)}](${safeUrl(source.url)})${suffix}`;
  });
  return `${SOURCES_HEADING}\n\n${items.join("\n")}`;
}

/**
 * The body to store. `sources === undefined` keeps whatever block `previousBodyMd` carried (a body-only
 * patch must not drop the references); `[]` removes it.
 */
export function composeBody(
  bodyMd: string,
  sources: readonly PublishingSource[] | undefined,
  previousBodyMd?: string,
): string {
  const { main } = splitSourcesBlock(bodyMd);
  const block =
    sources !== undefined
      ? sources.length === 0
        ? null
        : renderSourcesBlock(sources)
      : previousBodyMd === undefined
        ? splitSourcesBlock(bodyMd).block
        : splitSourcesBlock(previousBodyMd).block;
  const base = main.replace(/\s+$/, "");
  return block === null ? `${base}\n` : `${base}\n\n${block}\n`;
}
