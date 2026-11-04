import type { ReactNode } from "react";

/*
 * Simplified SVG flags of the 22 Arab League states (emoji flags do not render on Windows).
 * Colours and layout follow the real flags; fine emblems are reduced to a recognisable mark.
 * Every flag is drawn in a 30x20 box. Decorative: the country name always sits next to it.
 */

/** Five-pointed star path centred on (cx, cy). */
function star(cx: number, cy: number, r: number, rot = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.4;
    const angle = ((rot + i * 36) * Math.PI) / 180;
    pts.push(
      `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`,
    );
  }
  return `M${pts.join("L")}Z`;
}

/** Crescent opening towards the end side (right in the flag's own drawing). */
function Crescent({
  cx,
  cy,
  r,
  fill,
  cut,
}: {
  cx: number;
  cy: number;
  r: number;
  fill: string;
  cut: string;
}) {
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill={fill} />
      <circle cx={cx + r * 0.3} cy={cy} r={r * 0.8} fill={cut} />
    </>
  );
}

const W = "#ffffff";
const BLACK = "#000000";
const RED = "#ce1126";
const GREEN = "#007a3d";

function stripes(colors: readonly string[], weights?: readonly number[]): ReactNode {
  const w = weights ?? colors.map(() => 1);
  const total = w.reduce((a, b) => a + b, 0);
  let y = 0;
  return colors.map((color, i) => {
    const h = (20 * (w[i] ?? 1)) / total;
    const node = <rect key={i} x="0" y={y} width="30" height={h + 0.05} fill={color} />;
    y += h;
    return node;
  });
}

const FLAGS: Record<string, () => ReactNode> = {
  EG: () => (
    <>
      {stripes([RED, W, BLACK])}
      <circle cx="15" cy="10" r="2.2" fill="#c09300" />
    </>
  ),
  SA: () => (
    <>
      <rect width="30" height="20" fill="#006c35" />
      <rect x="7" y="6.2" width="16" height="1.6" rx="0.8" fill={W} opacity="0.95" />
      <rect x="9" y="9" width="12" height="1.1" rx="0.5" fill={W} opacity="0.9" />
      <rect x="8" y="14" width="14" height="1.1" rx="0.5" fill={W} />
    </>
  ),
  AE: () => (
    <>
      {stripes([GREEN, W, BLACK])}
      <rect width="8" height="20" fill="#ef3340" />
    </>
  ),
  KW: () => (
    <>
      {stripes([GREEN, W, RED])}
      <path d="M0 0L9 6.7V13.3L0 20Z" fill={BLACK} />
    </>
  ),
  QA: () => (
    <>
      <rect width="30" height="20" fill="#8a1538" />
      <path
        d="M0 0H11L7.4 1.1L11 2.2L7.4 3.3L11 4.4L7.4 5.5L11 6.6L7.4 7.7L11 8.8L7.4 9.9L11 11L7.4 12.1L11 13.2L7.4 14.3L11 15.4L7.4 16.5L11 17.6L7.4 18.7L11 20H0Z"
        fill={W}
      />
    </>
  ),
  BH: () => (
    <>
      <rect width="30" height="20" fill="#ce1126" />
      <path d="M0 0H10L14 2L10 4L14 6L10 8L14 10L10 12L14 14L10 16L14 18L10 20H0Z" fill={W} />
    </>
  ),
  OM: () => (
    <>
      {stripes([W, RED, "#008000"])}
      <rect width="8" height="20" fill={RED} />
      <rect x="1.8" y="3" width="4.4" height="1.2" fill={W} />
    </>
  ),
  JO: () => (
    <>
      {stripes([BLACK, W, "#007a3d"])}
      <path d="M0 0L14 10L0 20Z" fill={RED} />
      <path d={star(4.2, 10, 2.2)} fill={W} />
    </>
  ),
  LB: () => (
    <>
      {stripes([RED, W, RED], [1, 2, 1])}
      <path d="M15 5L18 11H16.4L19 14.6H15.8V16.4H14.2V14.6H11L13.6 11H12Z" fill="#00a651" />
    </>
  ),
  SY: () => (
    <>
      {stripes(["#007a3d", W, BLACK])}
      <path d={star(9, 10, 1.7)} fill={RED} />
      <path d={star(15, 10, 1.7)} fill={RED} />
      <path d={star(21, 10, 1.7)} fill={RED} />
    </>
  ),
  IQ: () => (
    <>
      {stripes([RED, W, BLACK])}
      <rect x="8" y="8.8" width="14" height="2.4" rx="1" fill="#007a3d" />
    </>
  ),
  PS: () => (
    <>
      {stripes([BLACK, W, "#009736"])}
      <path d="M0 0L11 10L0 20Z" fill={RED} />
    </>
  ),
  YE: () => stripes([RED, W, BLACK]),
  SD: () => (
    <>
      {stripes([RED, W, BLACK])}
      <path d="M0 0L11 10L0 20Z" fill="#007229" />
    </>
  ),
  LY: () => (
    <>
      {stripes([RED, BLACK, "#239e46"], [1, 2, 1])}
      <Crescent cx={14.2} cy={10} r={3.2} fill={W} cut={BLACK} />
      <path d={star(17.8, 10, 1.5)} fill={W} />
    </>
  ),
  TN: () => (
    <>
      <rect width="30" height="20" fill="#e70013" />
      <circle cx="15" cy="10" r="5.6" fill={W} />
      <Crescent cx={14.4} cy={10} r={3.4} fill="#e70013" cut={W} />
      <path d={star(15.7, 10, 1.7)} fill="#e70013" />
    </>
  ),
  DZ: () => (
    <>
      <rect width="30" height="20" fill={W} />
      <rect width="15" height="20" fill="#006233" />
      <Crescent cx={14.6} cy={10} r={4.4} fill="#d21034" cut={W} />
      <path d={star(16.8, 10, 2)} fill="#d21034" />
    </>
  ),
  MA: () => (
    <>
      <rect width="30" height="20" fill="#c1272d" />
      <path
        d={star(15, 10.3, 5.2)}
        fill="none"
        stroke="#006233"
        strokeWidth="1"
        strokeLinejoin="miter"
      />
    </>
  ),
  MR: () => (
    <>
      <rect width="30" height="20" fill="#006233" />
      <rect width="30" height="2.4" fill="#d01c1f" />
      <rect y="17.6" width="30" height="2.4" fill="#d01c1f" />
      <path d="M9.5 8.4A5.5 5.5 0 0 0 20.5 8.4A5.5 5.5 0 0 1 9.5 8.4Z" fill="#ffc400" />
      <path d={star(15, 6.4, 1.5)} fill="#ffc400" />
    </>
  ),
  SO: () => (
    <>
      <rect width="30" height="20" fill="#4189dd" />
      <path d={star(15, 10.3, 5)} fill={W} />
    </>
  ),
  DJ: () => (
    <>
      <rect width="30" height="10" fill="#6ab2e7" />
      <rect y="10" width="30" height="10" fill="#12ad2b" />
      <path d="M0 0L15 10L0 20Z" fill={W} />
      <path d={star(4.6, 10, 2.1)} fill="#d7141a" />
    </>
  ),
  KM: () => (
    <>
      {stripes(["#ffc61e", W, "#ce1126", "#3a75c4"])}
      <path d="M0 0L14 10L0 20Z" fill="#3d8e33" />
      <Crescent cx={4.2} cy={10} r={2.8} fill={W} cut="#3d8e33" />
    </>
  ),
};

export function Flag({ iso, className }: { iso: string; className?: string }) {
  const draw = FLAGS[iso.toUpperCase()];
  return (
    <svg
      viewBox="0 0 30 20"
      aria-hidden="true"
      focusable="false"
      className={`overflow-hidden rounded-[4px] shadow-[0_0_0_1px_rgb(11_18_32/0.14)] ${className ?? "h-[18px] w-[27px]"}`}
      // Hairline ring so white stripes keep their edge on the warm background.
    >
      {draw ? draw() : <rect width="30" height="20" fill="#d3dae6" />}
    </svg>
  );
}

/** The ISO codes that have a drawn flag (a test checks it covers ARAB_COUNTRIES). */
export const FLAG_ISOS = Object.keys(FLAGS);
