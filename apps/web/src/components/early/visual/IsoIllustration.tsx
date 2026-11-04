import type { ReactElement, ReactNode } from "react";
import "./early-visual.css";

type Props = {
  kind: "capture" | "understand" | "schedule";
  className?: string;
};

/*
 * Isometric helper: faces are drawn in local 2D coordinates and mapped onto the
 * iso planes with an affine matrix. x -> (cos30, sin30), y -> (-cos30, sin30), z -> up.
 * Strokes stay 1.25px thanks to non-scaling-stroke (no scaling happens anyway; kept for safety).
 */
const C = 0.866;
const S = 0.5;
/** Plane y = D (the large front face). */
const front = (d: number) => `matrix(${C} ${S} 0 -1 ${-d * C} ${d * S})`;
/** Plane x = W (the side face). */
const side = (w: number) => `matrix(${-C} ${S} 0 -1 ${w * C} ${w * S})`;
/** Plane z = H (the top face). */
const top = (h: number) => `matrix(${C} ${S} ${-C} ${S} 0 ${-h})`;

type BoxProps = { w: number; d: number; h: number; z?: number; children?: ReactNode; topChildren?: ReactNode };

function Box({ w, d, h, z = 0, children, topChildren }: BoxProps) {
  return (
    <g transform={`translate(0 ${-z})`}>
      <g transform={top(h)}>
        <rect x="0" y="0" width={w} height={d} className="ev-iso-face" />
        {topChildren}
      </g>
      <g transform={side(w)}>
        <rect x="0" y="0" width={d} height={h} className="ev-iso-face" />
      </g>
      <g transform={front(d)}>
        <rect x="0" y="0" width={w} height={h} className="ev-iso-face" />
        {children}
      </g>
    </g>
  );
}

function Capture() {
  return (
    <g transform="translate(64 106)">
      <Box w={44} d={7} h={78}>
        <rect x="5" y="9" width="34" height="62" rx="2.5" className="ev-iso-line" />
        {/* camera lens, accent */}
        <circle cx="22" cy="4.5" r="1.6" className="ev-iso-accent" />
        {/* document lines */}
        <path d="M12 56H32M12 49H28M12 42H32M12 35H24" className="ev-iso-line" />
        {/* scan brackets, accent */}
        <path
          d="M10 26V20H16M34 20H28M10 62V68M34 62V68M10 68H16M34 68H28"
          className="ev-iso-accent"
          transform="translate(0 -6)"
        />
      </Box>
    </g>
  );
}

function Understand() {
  return (
    <g transform="translate(80 68)">
      <Box w={50} d={50} h={3} z={0} />
      <Box w={50} d={50} h={3} z={13} />
      <Box
        w={50}
        d={50}
        h={3}
        z={26}
        topChildren={
          <>
            <path d="M8 12H30M8 20H38M8 28H26M8 36H34" className="ev-iso-line" />
            <circle cx="35" cy="14" r="8" className="ev-iso-accent" />
            <path d="M35 8V20M29 14H41" className="ev-iso-accent" />
          </>
        }
      />
    </g>
  );
}

function Schedule() {
  const cells: ReactElement[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const accent = r === 1 && c === 2;
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={7 + c * 12}
          y={7 + r * 11}
          width="8"
          height="7"
          rx="1"
          className={accent ? "ev-iso-accent" : "ev-iso-line"}
        />,
      );
    }
  }
  return (
    <>
      <g transform="translate(58 94)">
        <Box w={58} d={8} h={60}>
          <path d="M0 44H58" className="ev-iso-line" />
          {cells}
          <path d="M16 60V68M42 60V68" className="ev-iso-line" />
        </Box>
      </g>
      {/* bell, flat so it reads as a floating badge */}
      <g transform="translate(124 106)">
        <path
          d="M-9 6C-9 6 -6 3 -6 -3C-6 -8 -3 -11 0 -11C3 -11 6 -8 6 -3C6 3 9 6 9 6Z M-2.5 9A2.5 2.5 0 0 0 2.5 9"
          className="ev-iso-accent"
        />
        <path d="M0 -14V-11" className="ev-iso-accent" />
      </g>
    </>
  );
}

export function IsoIllustration({ kind, className }: Props) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 160 160"
      width="160"
      height="160"
      className={`ev-iso${className ? ` ${className}` : ""}`}
    >
      {kind === "capture" ? <Capture /> : kind === "understand" ? <Understand /> : <Schedule />}
    </svg>
  );
}
