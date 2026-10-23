import { t } from "@wasfa/shared/i18n";
import Link from "next/link";

import { publicEnv } from "../lib/env";
import { localizedPath, type Locale } from "../lib/locale";

import type { SettingValue } from "@wasfa/shared/settings";

export type Branding = SettingValue<"branding">;

/** Height of the logo in every header and sign-in frame (the chip it replaces is `size-11`). */
const LOGO_HEIGHT = 44;

export interface BrandMarkProps {
  /** The `branding` public setting. Omitted (or no logo uploaded): the built-in symbol and the name. */
  branding?:
    | Pick<Branding, "nameAr" | "logoUrl" | "logoWidth" | "logoHeight" | "showNameWithLogo">
    | undefined;
  /** English shows the English brand name (the admin's name is Arabic) and links to `/en`. */
  locale?: Locale;
}

/** The built-in symbol (brand/symbol.svg: a و whose tail becomes a check, on the navy tile). */
function BrandSymbol({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label={name} className="size-11 shrink-0">
      <rect width="24" height="24" rx="5.5" fill="#1e3a8a" />
      <g fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8.6" cy="8.8" r="3.3" />
        <path d="M11.9 8.8C12.7 11.6 12.5 14.8 11.6 17.4L19.4 7.4" />
      </g>
    </svg>
  );
}

/**
 * Only logos uploaded through /admin/branding (served by our API) are shown: the CSP's img-src allows
 * no other origin, so an external URL typed into the settings would render as a broken image.
 */
export function brandLogoSrc(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).origin === new URL(publicEnv.NEXT_PUBLIC_API_URL).origin ? url : null;
  } catch {
    return null;
  }
}

/**
 * The logo linking home. With an uploaded logo it shows the image alone (the file is assumed to carry
 * the wordmark) unless the admin ticked "show the name next to the logo". The stored pixel size gives
 * the image its aspect ratio before it loads, so the header does not shift.
 */
export function BrandMark({ branding, locale = "ar" }: BrandMarkProps) {
  const name =
    locale === "en" ? t("brand.name", undefined, "en") : (branding?.nameAr ?? t("brand.name"));
  const logoUrl = brandLogoSrc(branding?.logoUrl ?? null);
  const withName = logoUrl === null || branding?.showNameWithLogo === true;

  const { logoWidth, logoHeight } = branding ?? {};
  const displayWidth =
    typeof logoWidth === "number" && typeof logoHeight === "number"
      ? Math.max(1, Math.round((LOGO_HEIGHT * logoWidth) / logoHeight))
      : undefined;

  return (
    <Link
      href={localizedPath("/", locale)}
      className="inline-flex min-h-11 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:shadow-focus"
    >
      {logoUrl === null ? (
        <BrandSymbol name={name} />
      ) : (
        <img
          src={logoUrl}
          // Shown alone, the image is the link's only name; beside the name text it would repeat it.
          alt={withName ? "" : name}
          height={LOGO_HEIGHT}
          {...(displayWidth === undefined ? {} : { width: displayWidth })}
          className="h-11 w-auto max-w-56 object-contain"
        />
      )}
      {withName ? (
        // The built-in symbol already carries the name for screen readers; the text would repeat it.
        <span
          {...(logoUrl === null ? { "aria-hidden": true } : {})}
          className="whitespace-nowrap font-heading text-2xl font-bold text-primary"
        >
          {name}
        </span>
      ) : null}
    </Link>
  );
}
