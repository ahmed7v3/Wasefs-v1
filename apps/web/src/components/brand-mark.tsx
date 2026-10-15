import { t } from "@wasfa/shared/i18n";
import { Pill } from "lucide-react";
import Link from "next/link";

import { publicEnv } from "../lib/env";

import type { SettingValue } from "@wasfa/shared/settings";

export type Branding = SettingValue<"branding">;

/** Height of the logo in every header and sign-in frame (the chip it replaces is `size-11`). */
const LOGO_HEIGHT = 44;

export interface BrandMarkProps {
  /** The `branding` public setting. Omitted (or no logo uploaded): the built-in chip and the name. */
  branding?:
    | Pick<Branding, "nameAr" | "logoUrl" | "logoWidth" | "logoHeight" | "showNameWithLogo">
    | undefined;
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
export function BrandMark({ branding }: BrandMarkProps) {
  const name = branding?.nameAr ?? t("brand.name");
  const logoUrl = brandLogoSrc(branding?.logoUrl ?? null);
  const withName = logoUrl === null || branding?.showNameWithLogo === true;

  const { logoWidth, logoHeight } = branding ?? {};
  const displayWidth =
    typeof logoWidth === "number" && typeof logoHeight === "number"
      ? Math.max(1, Math.round((LOGO_HEIGHT * logoWidth) / logoHeight))
      : undefined;

  return (
    <Link
      href="/"
      className="inline-flex min-h-11 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:shadow-focus"
    >
      {logoUrl === null ? (
        <span className="grid size-11 place-items-center rounded-lg bg-primary text-on-primary shadow-card">
          <Pill className="size-6" aria-hidden="true" />
        </span>
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
        <span className="whitespace-nowrap font-heading text-2xl font-bold text-primary">
          {name}
        </span>
      ) : null}
    </Link>
  );
}
