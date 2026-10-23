import { landingFor } from "../../content/landing-locale";

import type { Locale } from "../../lib/locale";

/*
 * The hero illustration (BRAND-AND-HOMEPAGE §3.1): a handwritten prescription card, a scan beam,
 * and a structured result card with three rows (two confident, one flagged for the pharmacist).
 * The cards carry a thin slab edge on one 30-degree axis, which is the only "isometric" cue, so the
 * text on them stays flat and crisp. Pure inline SVG (no request, well under 25 KB); the words are
 * real SVG text in the page language, and the whole picture is one `role="img"` with the alt text.
 *
 * Coordinates are absolute screen coordinates in a 520 x 340 box, so the wrapper is `ltr`; Arabic
 * mirrors the layout by computing mirrored x positions (`px`) and text anchors, never by flipping
 * the drawing, so no glyph is ever mirrored. Motion lives in globals.css (`.hero-*`): an intro of
 * about 2.4 s, then still, with an occasional shimmer while the hero is in view; all of it is off
 * under reduced motion, which leaves the finished picture.
 *
 * Three stacked layers move at different rates on scroll (`motion-parallax`): glow, cards, icons.
 */

const W = 520;
const H = 340;

/** Plan of the scene in left-to-right coordinates; `px` mirrors them for Arabic. */
const PRESCRIPTION = { x: 12, y: 64, w: 140, h: 200 } as const;
const RESULT = { x: 196, y: 28, w: 312, h: 284 } as const;
const SLAB = { dx: 9, dy: 5 } as const;
const BEAM_W = 20;
const ROW = { top: 54, pitch: 70, h: 60, inset: 14 } as const;

const NAVY = "#1e3a8a";
const BLUE = "#3b82f6";
const INK = "#0b1220";
const MUTED = "#4a5670";
const EDGE = "#c4cddd";
const SLAB_FILL = "#dfe4ee";
const SUCCESS = "#15803d";
const WARN = "#b45309";
const WARN_EDGE = "#d4902e";

function Scene({ locale }: { locale: Locale }) {
  const { visual } = landingFor(locale);
  const rtl = locale === "ar";
  /** Left edge of a box of width `w` that sits at `x` in the left-to-right plan. */
  const px = (x: number, w: number): number => (rtl ? W - x - w : x);
  /** Text anchored at the start side of a box: its start edge, mirrored for Arabic. */
  const startOf = (x: number, w: number, pad: number): number =>
    rtl ? px(x, w) + w - pad : px(x, w) + pad;
  // SVG `start` follows the text direction: with `direction="rtl"` it is the right edge.
  const anchor = "start";
  const dir = rtl ? "rtl" : "ltr";

  const card = PRESCRIPTION;
  const cardX = px(card.x, card.w);
  const result = RESULT;
  const resultX = px(result.x, result.w);
  const dxSlab = rtl ? -SLAB.dx : SLAB.dx;

  /** A handwriting-like line: `waves` small humps starting at `x` and running to the page's end side. */
  const squiggle = (x: number, y: number, waves: number): string => {
    const s = rtl ? -1 : 1;
    return `M${x} ${y}q${5 * s} -5 ${10 * s} 0${`t${10 * s} 0`.repeat(waves - 1)}`;
  };
  const inkStart = rtl ? cardX + card.w - 14 : cardX + 14;

  const chipW = Math.round(visual.sampleBadge.length * 7.4 + 28);
  const chipX = px(result.x + result.w - chipW - 14, chipW);
  const badgeW = (text: string): number => Math.round(text.length * 6.8 + 22);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="absolute inset-0 size-full"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="hero-beam-fill" x1={rtl ? 1 : 0} y1="0" x2={rtl ? 0 : 1} y2="0">
          <stop offset="0" stopColor={BLUE} stopOpacity="0" />
          <stop offset="1" stopColor={BLUE} stopOpacity="0.5" />
        </linearGradient>
      </defs>

      {/* Contact shadow under both cards. */}
      <ellipse cx={W / 2} cy="326" rx="214" ry="9" fill={NAVY} fillOpacity="0.08" />

      {/* Prescription card: it settles into place first. */}
      <g className="hero-paper">
        <rect
          x={cardX + dxSlab}
          y={card.y + SLAB.dy}
          width={card.w}
          height={card.h}
          rx="10"
          fill={SLAB_FILL}
          stroke={EDGE}
        />
        <rect
          x={cardX}
          y={card.y}
          width={card.w}
          height={card.h}
          rx="10"
          fill="#ffffff"
          stroke={EDGE}
        />
        <text
          x={startOf(card.x, card.w, 14)}
          y={card.y + 34}
          fontSize="22"
          fontWeight="700"
          fill={NAVY}
          textAnchor={rtl ? "end" : "start"}
          direction="ltr"
        >
          Rx
        </text>
        <circle cx={rtl ? cardX + 22 : cardX + card.w - 22} cy={card.y + 26} r="7" fill="#60a5fa" />
        <g strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5">
          <path d={squiggle(inkStart, card.y + 66, 8)} stroke="#64708a" strokeOpacity="0.8" />
          <path d={squiggle(inkStart, card.y + 96, 7)} stroke="#64708a" strokeOpacity="0.8" />
          <path d={squiggle(inkStart, card.y + 126, 8)} stroke="#64708a" strokeOpacity="0.8" />
          <path
            d={squiggle(inkStart, card.y + 156, 6)}
            stroke={WARN}
            strokeOpacity="0.9"
            strokeDasharray="3 6"
          />
        </g>
      </g>

      {/* A chevron in the gap: the line goes from the card to the result. */}
      <path
        d={rtl ? "M345 163l-7 7 7 7" : "M175 163l7 7-7 7"}
        stroke={BLUE}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Result card with its attached sample chip. */}
      <g>
        <rect
          x={resultX + dxSlab}
          y={result.y + SLAB.dy}
          width={result.w}
          height={result.h}
          rx="14"
          fill={SLAB_FILL}
          stroke={EDGE}
        />
        <rect
          x={resultX}
          y={result.y}
          width={result.w}
          height={result.h}
          rx="14"
          fill="#ffffff"
          stroke={EDGE}
        />
        <text
          x={startOf(result.x, result.w, 20)}
          y={result.y + 36}
          fontSize="18"
          fontWeight="700"
          fill={INK}
          textAnchor={anchor}
          direction={dir}
        >
          {visual.resultTitle}
        </text>
        <rect
          x={chipX}
          y={result.y - 14}
          width={chipW}
          height="28"
          rx="14"
          fill="#e3eafb"
          stroke={NAVY}
          strokeOpacity="0.35"
        />
        <text
          x={chipX + chipW / 2}
          y={result.y + 5}
          fontSize="13"
          fontWeight="700"
          fill={NAVY}
          textAnchor="middle"
          direction={dir}
        >
          {visual.sampleBadge}
        </text>

        {visual.items.map((item, index) => {
          const flagged = item.flag === "review";
          const rowY = result.y + ROW.top + index * ROW.pitch;
          const rowX = px(result.x + ROW.inset, result.w - ROW.inset * 2);
          const rowW = result.w - ROW.inset * 2;
          const label = flagged ? visual.review : visual.confidenceHigh;
          const labelW = badgeW(label);
          const textStart = startOf(result.x + ROW.inset, rowW, 50);
          const badgeX = rtl ? textStart - labelW : textStart;
          return (
            <g key={item.name} className={`hero-row hero-row-${index + 1}`}>
              <rect
                x={rowX}
                y={rowY}
                width={rowW}
                height={ROW.h}
                rx="10"
                fill={flagged ? "#fef3c7" : "#f6f6f4"}
                stroke={flagged ? WARN_EDGE : "#d3dae6"}
                strokeWidth={flagged ? 1.5 : 1}
                className={flagged ? "hero-flag" : undefined}
              />
              <circle
                cx={startOf(result.x + ROW.inset, rowW, 24)}
                cy={rowY + ROW.h / 2}
                r="12"
                fill={flagged ? WARN : SUCCESS}
              />
              {flagged ? (
                <path
                  d={`M${startOf(result.x + ROW.inset, rowW, 24)} ${rowY + 24}v7m0 4v0.5`}
                  stroke="#ffffff"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d={`M${startOf(result.x + ROW.inset, rowW, 24) - 5} ${rowY + 31}l4 4 7-8`}
                  stroke="#ffffff"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              <text
                x={textStart}
                y={rowY + 26}
                fontSize="16"
                fontWeight="700"
                fill={INK}
                textAnchor={anchor}
                direction={dir}
              >
                {item.name}
              </text>
              <rect
                x={badgeX}
                y={rowY + 34}
                width={labelW}
                height="20"
                rx="10"
                fill={flagged ? "#ffffff" : "#dcfce7"}
                stroke={flagged ? WARN_EDGE : SUCCESS}
                strokeOpacity="0.5"
              />
              <text
                x={badgeX + labelW / 2}
                y={rowY + 48}
                fontSize="12"
                fontWeight="700"
                fill={flagged ? WARN : SUCCESS}
                textAnchor="middle"
                direction={dir}
              >
                {label}
              </text>
            </g>
          );
        })}
        <text
          x={startOf(result.x, result.w, 20)}
          y={result.y + result.h - 8}
          fontSize="12"
          fill={MUTED}
          textAnchor={anchor}
          direction={dir}
        >
          {visual.note}
        </text>
      </g>

      {/* Scan beam: a soft band with a bright leading edge that sweeps once over the prescription. */}
      <g className={`hero-beam ${rtl ? "[--beam-dx:-120px]" : "[--beam-dx:120px]"}`}>
        <rect
          x={rtl ? cardX + card.w - BEAM_W : cardX}
          y={card.y - 8}
          width={BEAM_W}
          height={card.h + 16}
          fill="url(#hero-beam-fill)"
        />
        <path
          d={`M${rtl ? cardX + card.w - BEAM_W : cardX + BEAM_W} ${card.y - 8}v${card.h + 16}`}
          stroke={BLUE}
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

/** Three decorative icons on an 8 px grid, each with its own slow motion; clear of all text. */
function Icons({ locale }: { locale: Locale }) {
  const rtl = locale === "ar";
  const place = (x: number, size: number): number => (rtl ? W - x - size : x);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="absolute inset-0 size-full"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g className="float-slow [animation-duration:7s] [animation-delay:0.4s]">
        <use href="#mascot-capsule" x={place(8, 56)} y="0" width="56" height="56" />
      </g>
      <g className="float-slow [animation-duration:9s] [animation-delay:1.6s]">
        <use href="#mascot-tablet" x={place(112, 48)} y="8" width="48" height="48" />
      </g>
      <g className="float-slow [animation-duration:8s] [animation-delay:2.4s]">
        <use href="#mascot-droplet" x={place(104, 48)} y="280" width="48" height="48" />
      </g>
    </svg>
  );
}

/**
 * The scene in a reserved `aspect-ratio` box (no layout shift), capped at 52 svh tall on a phone.
 * The wrapper is `ltr` because the drawing is in absolute coordinates; the text inside is set per
 * language. `landing.visual.alt` describes the whole picture for assistive technology.
 */
export function IsoScene({ locale = "ar" }: { locale?: Locale }) {
  const { visual } = landingFor(locale);
  const rtl = locale === "ar";
  return (
    <div dir="ltr" role="img" aria-label={visual.alt} className="hero-scene relative">
      <div
        aria-hidden="true"
        className="motion-parallax absolute inset-x-[8%] inset-y-[6%] rounded-full bg-[radial-gradient(closest-side,var(--color-accent-soft),transparent)] [--parallax-shift:6px]"
      />
      <div aria-hidden="true" className="motion-parallax absolute inset-0 [--parallax-shift:12px]">
        <Scene locale={locale} />
        <div className="hero-shimmer-gate pointer-events-none absolute inset-0">
          <div
            className={`absolute top-[8.24%] h-[83.53%] w-[60%] overflow-hidden rounded-[2.5%] ${
              rtl ? "start-[2.31%]" : "start-[37.69%]"
            }`}
          >
            <div className="hero-shimmer h-full w-1/4 bg-linear-to-r from-transparent via-white/45 to-transparent" />
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="motion-parallax absolute inset-0 [--parallax-shift:24px]">
        <Icons locale={locale} />
      </div>
    </div>
  );
}
