import { landing } from "../../content/landing";

import { Mascot } from "./mascot";

const { visual } = landing;

/*
 * The hero illustration: a prescription sheet on an isometric platform. A light curtain sweeps over
 * the sheet and the handwriting turns into three structured result bars (two confirmed, one flagged
 * for review) while small data blocks flow between them; the star mascot watches from the middle.
 *
 * Pure SVG, no raster image and no JavaScript. The geometry is computed here from plan coordinates
 * (x, y on the platform, z up) with a 2:1 isometric projection, so the whole scene is a handful of
 * polygons. Animation lives in globals.css (`.iso-scan`, `.iso-packet`, `.mascot-*`), switches off
 * under reduced motion and leaves a complete still picture.
 *
 * Plan axes on screen: x runs down to the right, y runs down to the left, so the sheet (low y) sits
 * at the upper right and the results (high y) at the lower left, which reads right to left.
 */

/** Screen pixels per plan unit, and the origin of the projection. */
const U = 18;
const OX = 328;
const OY = 140;

type Point = readonly [number, number];

function project(x: number, y: number, z: number): Point {
  return [OX + (x - y) * U, OY + ((x + y) * U) / 2 - z];
}

function points(list: readonly (readonly [number, number, number])[]): string {
  return list.map(([x, y, z]) => project(x, y, z).join(",")).join(" ");
}

/** `transform` that maps a flat drawing in plan coordinates onto the plane at height `z`. */
function plane(z: number): string {
  return `matrix(${U} ${U / 2} ${-U} ${U / 2} ${OX} ${OY - z})`;
}

interface BoxColors {
  top: string;
  left: string;
  right: string;
  stroke: string;
}

/** A box seen from the front corner: top face, the face towards +y (left) and the one towards +x (right). */
function Box({
  x0,
  y0,
  x1,
  y1,
  z0,
  z1,
  colors,
}: {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z0: number;
  z1: number;
  colors: BoxColors;
}) {
  return (
    <g stroke={colors.stroke} strokeWidth="1" strokeLinejoin="round">
      <polygon
        points={points([
          [x0, y1, z1],
          [x1, y1, z1],
          [x1, y1, z0],
          [x0, y1, z0],
        ])}
        fill={colors.left}
      />
      <polygon
        points={points([
          [x1, y0, z1],
          [x1, y1, z1],
          [x1, y1, z0],
          [x1, y0, z0],
        ])}
        fill={colors.right}
      />
      <polygon
        points={points([
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
        ])}
        fill={colors.top}
      />
    </g>
  );
}

const PLATFORM: BoxColors = {
  top: "#fcfcfb",
  left: "#eceef3",
  right: "#dfe3eb",
  stroke: "#d3d9e5",
};
const SHEET: BoxColors = { top: "#ffffff", left: "#e6e9f0", right: "#d9dee8", stroke: "#c4cddd" };
const CONFIRMED: BoxColors = {
  top: "#ffffff",
  left: "#c3d3f6",
  right: "#a6baee",
  stroke: "#8ea6e6",
};
const FLAGGED: BoxColors = { top: "#fff8ea", left: "#f6dcaa", right: "#eac684", stroke: "#d4902e" };
const BLOCK_BLUE: BoxColors = {
  top: "#60a5fa",
  left: "#3b82f6",
  right: "#2563eb",
  stroke: "#2563eb",
};
const BLOCK_NAVY: BoxColors = {
  top: "#3b5bb5",
  left: "#1e3a8a",
  right: "#172e6e",
  stroke: "#172e6e",
};
const BLOCK_PALE: BoxColors = {
  top: "#ffffff",
  left: "#e6e9f0",
  right: "#d9dee8",
  stroke: "#cdd4e2",
};

/** A handwriting-like line along plan x: a chain of small waves. */
function squiggle(x: number, y: number, length: number): string {
  const waves = Math.max(2, Math.floor(length / 0.7));
  return `M${x} ${y}q0.35 -0.3 0.7 0${"t0.7 0".repeat(waves - 1)}`;
}

/** Sheet rows: length of the handwriting in plan units. */
const ROWS = [4.6, 3.9, 5, 3.2, 4.2] as const;
/** Result bars along plan y, the last one is the flagged line. */
const BARS = [
  { y: 9.8, colors: CONFIRMED },
  { y: 11.9, colors: CONFIRMED },
  { y: 14, colors: FLAGGED },
] as const;
/** Low blocks on the platform between the sheet and the bars, like the keys of the reference. */
const BLOCKS = [
  { x: 4.4, y: 7.1, h: 3, colors: BLOCK_PALE },
  { x: 5.4, y: 7.1, h: 6, colors: BLOCK_BLUE },
  { x: 6.4, y: 7.1, h: 2.5, colors: BLOCK_PALE },
  { x: 4.4, y: 8.1, h: 5, colors: BLOCK_PALE },
  { x: 5.4, y: 8.1, h: 2.5, colors: BLOCK_PALE },
  { x: 6.4, y: 8.1, h: 5.5, colors: BLOCK_NAVY },
] as const;
/** Data blocks that fly from the sheet towards the bars (see `.iso-packet`). */
const PACKETS = [
  { x: 5, delay: "[animation-delay:0s]", colors: BLOCK_BLUE },
  { x: 6, delay: "[animation-delay:1.2s]", colors: BLOCK_NAVY },
  { x: 7, delay: "[animation-delay:2.4s]", colors: BLOCK_BLUE },
] as const;

const SLAB_TOP = 10;
const SHEET_TOP = 12;
const BAR_TOP = 18;

function SceneSvg() {
  const [mx, my] = project(2.4, 8.2, SLAB_TOP);
  return (
    <svg
      viewBox="28 112 456 268"
      className="relative h-auto w-full"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="iso-beam-fill" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#60a5fa" stopOpacity="0.55" />
          <stop offset="1" stopColor="#60a5fa" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Soft contact shadow of the platform. */}
      <polygon
        points={points([
          [0, 0, 0],
          [8, 0, 0],
          [8, 16, 0],
          [0, 16, 0],
        ])}
        transform="translate(0 14)"
        fill="#1e3a8a"
        fillOpacity="0.1"
      />

      <Box x0={0} y0={0} x1={8} y1={16} z0={0} z1={SLAB_TOP} colors={PLATFORM} />

      {/* Fine grid on the platform. */}
      <g transform={plane(SLAB_TOP)} stroke="#e5e8ef" strokeWidth="1">
        {Array.from({ length: 7 }, (_, index) => (
          <path key={`gx-${index}`} d={`M${index + 1} 0V16`} vectorEffect="non-scaling-stroke" />
        ))}
        {Array.from({ length: 15 }, (_, index) => (
          <path key={`gy-${index}`} d={`M0 ${index + 1}H8`} vectorEffect="non-scaling-stroke" />
        ))}
      </g>

      {/* The prescription sheet with its handwriting. */}
      <Box x0={1} y0={0.6} x1={7} y1={6.8} z0={SLAB_TOP} z1={SHEET_TOP} colors={SHEET} />
      <g transform={plane(SHEET_TOP)}>
        <rect x="1.5" y="1.2" width="1.9" height="0.4" rx="0.1" fill="#1e3a8a" />
        <circle cx="6.1" cy="1.4" r="0.38" fill="#60a5fa" />
        <g strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
          {ROWS.map((length, index) => (
            <path
              key={`row-${index}`}
              d={squiggle(1.5, 2.5 + index * 0.9, length)}
              stroke={index === ROWS.length - 1 ? "#b45309" : "#64708a"}
              strokeOpacity={index === ROWS.length - 1 ? 0.9 : 0.7}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      </g>

      {/* Keys between the sheet and the results. */}
      {BLOCKS.map((block) => (
        <Box
          key={`${block.x}-${block.y}`}
          x0={block.x}
          y0={block.y}
          x1={block.x + 0.75}
          y1={block.y + 0.75}
          z0={SLAB_TOP}
          z1={SLAB_TOP + block.h}
          colors={block.colors}
        />
      ))}

      {/* Mascot: ground shadow, then the body (it floats gently). */}
      <ellipse cx={mx} cy={my} rx="32" ry="11" fill="#1e3a8a" fillOpacity="0.16" />
      <g className="mascot-bob">
        <use href="#mascot-star" x={mx - 50} y={my - 92} width="100" height="100" />
      </g>

      {/* Result bars: confirmed lines and the one flagged for review. */}
      {BARS.map((bar, index) => {
        const flagged = bar.colors === FLAGGED;
        return (
          <g key={bar.y}>
            <Box
              x0={0.9}
              y0={bar.y}
              x1={7.1}
              y1={bar.y + 1.4}
              z0={SLAB_TOP}
              z1={BAR_TOP}
              colors={bar.colors}
            />
            <g transform={plane(BAR_TOP)} strokeLinecap="round">
              <circle cx="1.55" cy={bar.y + 0.7} r="0.34" fill={flagged ? "#d4902e" : "#3b82f6"} />
              <path
                d={`M2.3 ${bar.y + 0.48}H${index === 1 ? 5.1 : 5.5}`}
                stroke="#0b1220"
                strokeOpacity="0.8"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={`M2.3 ${bar.y + 0.98}H${index === 1 ? 4.2 : 4.6}`}
                stroke="#8792a8"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
              <rect
                x="6"
                y={bar.y + 0.35}
                width="0.85"
                height="0.7"
                rx="0.2"
                fill={flagged ? "#d4902e" : "#3b82f6"}
                fillOpacity={flagged ? 0.9 : 0.85}
              />
            </g>
          </g>
        );
      })}

      {/* The light curtain: starts at the back edge of the sheet and sweeps towards the front. */}
      <g className="iso-scan">
        <polygon
          points={points([
            [0.8, 0.8, SHEET_TOP],
            [7.2, 0.8, SHEET_TOP],
            [7.2, 0.8, SHEET_TOP + 34],
            [0.8, 0.8, SHEET_TOP + 34],
          ])}
          fill="url(#iso-beam-fill)"
        />
        <path
          d={`M${project(0.8, 0.8, SHEET_TOP).join(" ")}L${project(7.2, 0.8, SHEET_TOP).join(" ")}`}
          stroke="#2563eb"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>

      {/* Data blocks on their way from the sheet to the results. */}
      {PACKETS.map((packet) => (
        <g key={packet.x} className={`iso-packet ${packet.delay}`}>
          <Box
            x0={packet.x}
            y0={3.4}
            x1={packet.x + 0.6}
            y1={4}
            z0={SHEET_TOP + 16}
            z1={SHEET_TOP + 21}
            colors={packet.colors}
          />
        </g>
      ))}
    </svg>
  );
}

/**
 * The scene, a soft glow behind it, three small mascots and the two floating chips (HTML, so the
 * Arabic is real text). The wrapper is `ltr` because the drawing is in absolute screen coordinates;
 * the chips switch back to `rtl`.
 */
export function IsoScene() {
  return (
    <div dir="ltr" role="img" aria-label={visual.alt} className="relative mx-auto w-full max-w-2xl">
      <div
        aria-hidden="true"
        className="absolute inset-x-[8%] inset-y-[6%] rounded-full bg-[radial-gradient(closest-side,var(--color-accent-soft),transparent)]"
      />
      <SceneSvg />
      <span className="float-slow absolute start-[1%] top-[2%] [animation-delay:0.8s]">
        <Mascot name="capsule" className="size-12 sm:size-16" />
      </span>
      <span className="float-slow absolute start-[88%] top-[66%] [animation-delay:2s]">
        <Mascot name="droplet" className="size-12 sm:size-14" />
      </span>
      <span className="float-slow absolute start-[70%] top-[0%] [animation-delay:1.6s]">
        <Mascot name="tablet" className="size-10 sm:size-12" />
      </span>
      <span className="float-slow absolute start-[6%] top-[24%]">
        <span
          dir="rtl"
          className="block rounded-full border border-success/25 bg-surface px-3 py-1 text-sm font-semibold text-success shadow-card"
        >
          {visual.confidenceHigh}
        </span>
      </span>
      <span className="float-slow absolute start-[17%] top-[76%] [animation-delay:1.2s]">
        <span
          dir="rtl"
          className="block rounded-full border border-warning/30 bg-warning-soft px-3 py-1 text-sm font-semibold text-warning shadow-card"
        >
          {visual.review}
        </span>
      </span>
    </div>
  );
}
