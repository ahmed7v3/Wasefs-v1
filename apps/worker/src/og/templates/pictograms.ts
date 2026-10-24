import type { OgDosageForm } from "@wasfa/shared/schemas/og";

/**
 * Neutral pictograms per dosage form, drawn in a 100x100 box with a navy stroke. Deliberately
 * generic outlines: never a product photo and never anything that could pass for a real pack.
 */
const STROKE =
  'fill="none" stroke="#1e3a8a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"';

const SHAPES: Record<OgDosageForm, string> = {
  tablet: `<circle cx="50" cy="50" r="30" ${STROKE}/><path d="M24 50h52" ${STROKE}/>`,
  capsule: `<g transform="rotate(-40 50 50)"><rect x="14" y="32" width="72" height="36" rx="18" ${STROKE}/><path d="M50 32v36" ${STROKE}/></g>`,
  syrup: `<path d="M42 14h16M44 14v14M56 14v14M34 36q0-8 10-8h12q10 0 10 8v46H34Z" ${STROKE}/><path d="M34 54h32" ${STROKE}/>`,
  injection: `<path d="M26 74 62 38M54 30l16 16M66 18l16 16M18 82l8-8M40 56l-6 6M48 48l-6 6" ${STROKE}/>`,
  cream: `<path d="M28 30h44v34H28ZM34 64v20h32V64M40 30V18h20v12" ${STROKE}/>`,
  drops: `<path d="M50 14Q24 46 24 62a26 26 0 0 0 52 0Q76 46 50 14Z" ${STROKE}/>`,
  inhaler: `<path d="M34 20h26v36H34ZM34 56v14q0 12 12 12h28M60 36h14" ${STROKE}/>`,
  other: `<circle cx="50" cy="50" r="32" ${STROKE}/><path d="M50 34v32M34 50h32" ${STROKE}/>`,
};

/** The pictogram as a nested `<svg>` of `size` px at (`x`, `y`), on a soft accent disc. */
export function pictogram(form: OgDosageForm, x: number, y: number, size: number): string {
  return `<circle cx="${String(x + size / 2)}" cy="${String(y + size / 2)}" r="${String(size / 2)}" fill="#e6f1fe" stroke="#60a5fa" stroke-width="3"/><svg x="${String(x + size * 0.16)}" y="${String(y + size * 0.16)}" width="${String(size * 0.68)}" height="${String(size * 0.68)}" viewBox="0 0 100 100">${SHAPES[form]}</svg>`;
}
