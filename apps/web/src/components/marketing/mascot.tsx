import { cn } from "@wasfa/ui";

import type { MascotName } from "../../content/landing";

/**
 * The mascot family of the landing page: simple geometric bodies (star, capsule, hexagon, droplet,
 * tablet, house-shaped blob, clover), flat colours from the mascot palette in `tokens.css`, two
 * small white eyes each. They are decorative, so every `<svg>` is `aria-hidden`.
 *
 * The page renders `MascotSprite` once and every repeated mascot is a `<use>` of one of its
 * symbols, which keeps the HTML small. Fills are token classes (never inline styles: the CSP
 * forbids them), and the classes resolve inside the symbols because they come from the document.
 */

/** Rounded n-pointed star as one closed path (the stroke, with round joins, softens the tips). */
function starPath(cx: number, cy: number, outer: number, inner: number, points: number): string {
  const steps = points * 2;
  const commands = Array.from({ length: steps }, (_, index) => {
    const angle = (Math.PI * 2 * index) / steps - Math.PI / 2;
    const radius = index % 2 === 0 ? outer : inner;
    const x = (cx + radius * Math.cos(angle)).toFixed(2);
    const y = (cy + radius * Math.sin(angle)).toFixed(2);
    return `${index === 0 ? "M" : "L"}${x} ${y}`;
  });
  return `${commands.join(" ")}Z`;
}

/** A regular hexagon with a pointed top, inscribed in a circle of `radius`. */
function hexagonPoints(cx: number, cy: number, radius: number): string {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 3) * index - Math.PI / 2;
    return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

const STAR = starPath(40, 40, 33, 25, 8);
const HEXAGON = hexagonPoints(40, 40, 27);

/** The two white eyes; `className` lets a symbol blink. */
function Eyes({ cx, cy, className }: { cx: number; cy: number; className?: string }) {
  return (
    <g className={className} fill="#ffffff">
      <rect x={cx - 11} y={cy - 5} width="6" height="10.5" rx="3" />
      <rect x={cx + 5} y={cy - 5} width="6" height="10.5" rx="3" />
    </g>
  );
}

/** A soft highlight that gives the flat bodies a little volume. */
function Shine({ cx, cy, angle = -35 }: { cx: number; cy: number; angle?: number }) {
  return (
    <ellipse
      cx={cx}
      cy={cy}
      rx="7"
      ry="3.4"
      transform={`rotate(${angle} ${cx} ${cy})`}
      fill="#ffffff"
      fillOpacity=".22"
    />
  );
}

/** Inline once per page; the `Mascot` components point at these symbols. */
export function MascotSprite() {
  return (
    <svg
      width="0"
      height="0"
      className="pointer-events-none absolute size-0 overflow-hidden"
      aria-hidden="true"
      focusable="false"
    >
      <symbol id="mascot-star" viewBox="0 0 80 80">
        <path
          d={STAR}
          className="fill-mascot-navy stroke-mascot-navy"
          strokeWidth="8"
          strokeLinejoin="round"
        />
        <Shine cx={25} cy={24} />
        <Eyes cx={40} cy={40} className="mascot-eyes" />
      </symbol>

      <symbol id="mascot-capsule" viewBox="0 0 80 80">
        <g transform="rotate(28 40 40)">
          <rect x="22" y="6" width="36" height="68" rx="18" className="fill-mascot-navy" />
          <path d="M22 24A18 18 0 0 1 58 24V40H22Z" className="fill-mascot-blue" />
          <Shine cx={32} cy={22} angle={-80} />
          <Eyes cx={40} cy={55} />
        </g>
      </symbol>

      <symbol id="mascot-hexagon" viewBox="0 0 80 80">
        <polygon
          points={HEXAGON}
          className="fill-mascot-coral stroke-mascot-coral"
          strokeWidth="10"
          strokeLinejoin="round"
        />
        <Shine cx={26} cy={25} />
        <Eyes cx={40} cy={40} />
      </symbol>

      <symbol id="mascot-droplet" viewBox="0 0 80 80">
        <path
          d="M40 6C52 22 64 34 64 50a24 24 0 0 1-48 0C16 34 28 22 40 6Z"
          className="fill-mascot-teal"
        />
        <Shine cx={29} cy={38} angle={-70} />
        <Eyes cx={40} cy={50} />
      </symbol>

      <symbol id="mascot-tablet" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="31" className="fill-mascot-amber" />
        <path d="M9.5 52h61" stroke="#0b1220" strokeOpacity=".14" strokeWidth="2.5" />
        <Shine cx={22} cy={25} />
        <Eyes cx={40} cy={36} />
      </symbol>

      <symbol id="mascot-blob" viewBox="0 0 80 80">
        <path
          d="M40 9 62 23Q68 27 68 35V57Q68 69 56 69H24Q12 69 12 57V35Q12 27 18 23Z"
          className="fill-mascot-olive"
        />
        <Shine cx={24} cy={27} />
        <Eyes cx={40} cy={46} />
      </symbol>

      <symbol id="mascot-clover" viewBox="0 0 80 80">
        <g className="fill-mascot-indigo">
          <circle cx="40" cy="21" r="16" />
          <circle cx="59" cy="40" r="16" />
          <circle cx="40" cy="59" r="16" />
          <circle cx="21" cy="40" r="16" />
          <rect x="24" y="24" width="32" height="32" />
        </g>
        <Shine cx={27} cy={22} />
        <Eyes cx={40} cy={40} />
      </symbol>
    </svg>
  );
}

export interface MascotProps {
  name: MascotName;
  /** Size and layout classes (e.g. `size-20`). */
  className?: string | undefined;
}

export function Mascot({ name, className }: MascotProps) {
  return (
    <svg
      viewBox="0 0 80 80"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    >
      <use href={`#mascot-${name}`} />
    </svg>
  );
}
