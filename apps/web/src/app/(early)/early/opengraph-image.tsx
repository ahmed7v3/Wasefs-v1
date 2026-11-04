import { ImageResponse } from "next/og";

import { early } from "../../../content/early";

export const alt = early.meta.ogAlt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const HEADLINE = early.hero.headlines.a;
const SUB = "وصفة AI تقرأ أصعب الروشتات وتشرح لك دواك في ثوانٍ";
const BRAND = early.brand;
const BADGE = "قريبًا — احجز مكانك مجانًا";

/**
 * Satori ships no Arabic font, and the Next font files are woff2 (unsupported). The one-off TTF is
 * fetched from Google Fonts at build time, subset to the glyphs used here. If that fails (offline
 * build) the image falls back to the drawn character and Latin text only: it never breaks the build.
 */
async function loadFont(): Promise<ArrayBuffer | null> {
  try {
    const text = encodeURIComponent(
      `${HEADLINE}${SUB}${BRAND}${BADGE}Wasfa AI early.wasfa.online ·`,
    );
    const css = await (
      await fetch(
        `https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@700&text=${text}`,
        { signal: AbortSignal.timeout(5_000) },
      )
    ).text();
    const url = /src: url\((https:[^)]+)\) format\('(?:truetype|opentype)'\)/.exec(css)?.[1];
    if (!url) return null;
    const font = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    return font.ok ? await font.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** A flat, drawn version of the character: navy blob body, two eyes with highlights, soft shadow. */
function Character() {
  return (
    <svg width="420" height="420" viewBox="0 0 400 400">
      <defs>
        <radialGradient id="body" cx="38%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#5b86ec" />
          <stop offset="55%" stopColor="#1e3a8a" />
          <stop offset="100%" stopColor="#14275f" />
        </radialGradient>
        <radialGradient id="halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="200" cy="200" r="200" fill="url(#halo)" />
      <ellipse cx="200" cy="352" rx="110" ry="14" fill="#0b1220" opacity="0.14" />
      <path
        d="M200 48C262 40 332 84 346 160C360 238 322 322 244 342C186 357 108 346 72 286C36 226 52 110 120 68C148 52 174 50 200 48Z"
        fill="url(#body)"
      />
      <ellipse
        cx="140"
        cy="108"
        rx="52"
        ry="26"
        fill="#ffffff"
        opacity="0.22"
        transform="rotate(-24 140 108)"
      />
      <ellipse cx="158" cy="186" rx="26" ry="34" fill="#ffffff" />
      <ellipse cx="242" cy="186" rx="26" ry="34" fill="#ffffff" />
      <ellipse cx="164" cy="192" rx="13" ry="18" fill="#0b1220" />
      <ellipse cx="248" cy="192" rx="13" ry="18" fill="#0b1220" />
      <circle cx="169" cy="184" r="4.5" fill="#ffffff" />
      <circle cx="253" cy="184" r="4.5" fill="#ffffff" />
      <path
        d="M170 262C190 280 216 280 236 262"
        stroke="#ffffff"
        strokeWidth="9"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Satori lays text out left-to-right even for Arabic (`direction: rtl` is ignored), which would put
 * the words in the wrong order. Each word is shaped on its own and the row runs right-to-left.
 */
function RtlText({
  text,
  fontSize,
  color,
  fontWeight = 700,
  lineHeight = 1.4,
  fill = true,
}: {
  text: string;
  fontSize: number;
  color: string;
  fontWeight?: 400 | 700;
  lineHeight?: number;
  fill?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row-reverse",
        flexWrap: "wrap",
        ...(fill ? { width: "100%" } : {}),
        columnGap: Math.round(fontSize * 0.2),
      }}
    >
      {text.split(" ").map((word, index) => (
        <div key={index} style={{ display: "flex", color, fontSize, fontWeight, lineHeight }}>
          {word}
        </div>
      ))}
    </div>
  );
}

export default async function OpengraphImage() {
  const font = await loadFont();
  const arabic = font !== null;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "row-reverse",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 72px",
        background: "linear-gradient(135deg, #f6f6f4 0%, #efeee9 100%)",
        fontFamily: arabic ? "Plex" : "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: 640,
          gap: 22,
          alignItems: "flex-end",
        }}
      >
        <div
          style={{
            display: "flex",
            padding: "10px 22px",
            borderRadius: 999,
            background: "#e3eafb",
          }}
        >
          <RtlText
            text={arabic ? BADGE : "Coming soon"}
            fontSize={28}
            color="#1e3a8a"
            fill={false}
          />
        </div>
        <RtlText
          text={arabic ? HEADLINE : "Wasfa AI"}
          fontSize={arabic ? 84 : 76}
          color="#0b1220"
          lineHeight={1.3}
        />
        <RtlText
          text={arabic ? SUB : "early.wasfa.online"}
          fontSize={32}
          color="#4a5670"
          fontWeight={400}
          lineHeight={1.6}
        />
        <RtlText
          text={arabic ? `${BRAND} · early.wasfa.online` : "wasfa.online"}
          fontSize={34}
          color="#1e3a8a"
        />
      </div>
      <Character />
    </div>,
    {
      ...size,
      ...(font
        ? { fonts: [{ name: "Plex", data: font, weight: 700 as const, style: "normal" as const }] }
        : {}),
    },
  );
}
