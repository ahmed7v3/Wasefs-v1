import { t, type Locale, type MessageKey } from "@wasfa/shared/i18n";

/*
 * Email layout. Mail clients ignore external CSS and web fonts, so the brand tokens of
 * `packages/ui/tokens.css` are copied here as literals. Keep them in step when the palette changes.
 * No remote images and no tracking pixels: the brand mark is text.
 */
const COLOR = {
  primary: "#1e3a8a",
  onPrimary: "#ffffff",
  bg: "#f5f7fb",
  surface: "#ffffff",
  text: "#0b1220",
  muted: "#4a5670",
  border: "#d3dae6",
} as const;

const FONT = "'Segoe UI', Tahoma, Arial, sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Only web links may reach an `href`: a `javascript:` or `data:` URL must never become clickable. */
export function assertWebLink(link: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new TypeError("Email link is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("Email link must be http(s)");
  }
  return url.toString();
}

export interface Block {
  paragraphs: string[];
  /** "Ignore this message if you did not ask for it": wrong for notices the user did not request. */
  ignoreNote: boolean;
  action?: { label: string; link: string };
  note?: string;
}

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

export interface LayoutInput {
  locale: Locale;
  name: string;
  subject: string;
  block: Block;
}

const dirOf = (locale: Locale) => (locale === "ar" ? "rtl" : "ltr");

/** Translates through the shared dictionary so copy lives with the other UI strings. */
export function tr(locale: Locale, key: MessageKey, params?: Record<string, string>): string {
  return t(key, params, locale);
}

export function renderLayout({ locale, name, subject, block }: LayoutInput): Rendered {
  const dir = dirOf(locale);
  const align = dir === "rtl" ? "right" : "left";
  const greeting =
    name === "" ? tr(locale, "email.greetingAnonymous") : tr(locale, "email.greeting", { name });
  const brand = tr(locale, "brand.name");

  const paragraphs = block.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.8;color:${COLOR.text};">${escapeHtml(paragraph)}</p>`,
    )
    .join("");

  const action = block.action
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(block.action.link)}" style="display:inline-block;background:${COLOR.primary};color:${COLOR.onPrimary};text-decoration:none;font-weight:700;font-size:16px;line-height:1.4;padding:14px 28px;border-radius:12px;">${escapeHtml(block.action.label)}</a></p>` +
      `<p style="margin:0 0 16px;font-size:14px;line-height:1.8;color:${COLOR.muted};">${escapeHtml(tr(locale, "email.linkFallback"))}<br><a href="${escapeHtml(block.action.link)}" dir="ltr" style="color:${COLOR.primary};word-break:break-all;">${escapeHtml(block.action.link)}</a></p>`
    : "";

  const note = block.note
    ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.8;color:${COLOR.muted};">${escapeHtml(block.note)}</p>`
    : "";

  const ignore = block.ignoreNote
    ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.8;color:${COLOR.muted};">${escapeHtml(tr(locale, "email.ignoreIfNotYou"))}</p>`
    : "";

  const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${COLOR.bg};direction:${dir};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.bg};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${COLOR.surface};border:1px solid ${COLOR.border};border-radius:16px;">
<tr><td style="padding:28px 28px 8px;font-family:${FONT};direction:${dir};text-align:${align};">
<div style="font-size:22px;font-weight:800;color:${COLOR.primary};margin-bottom:20px;">${escapeHtml(brand)}</div>
<p style="margin:0 0 16px;font-size:16px;line-height:1.8;color:${COLOR.text};">${escapeHtml(greeting)}</p>
${paragraphs}${action}${note}
${ignore}
</td></tr>
<tr><td style="padding:16px 28px 24px;font-family:${FONT};direction:${dir};text-align:${align};border-top:1px solid ${COLOR.border};font-size:12px;line-height:1.8;color:${COLOR.muted};">
${escapeHtml(tr(locale, "email.disclaimer"))}<br>${escapeHtml(tr(locale, "email.footer"))}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const textParts = [greeting, "", ...block.paragraphs.flatMap((paragraph) => [paragraph, ""])];
  if (block.action) {
    textParts.push(block.action.label + ":", block.action.link, "");
  }
  if (block.note) textParts.push(block.note, "");
  if (block.ignoreNote) textParts.push(tr(locale, "email.ignoreIfNotYou"), "");
  textParts.push("--", brand, tr(locale, "email.footer"));
  return { subject, html, text: textParts.join("\n") };
}
