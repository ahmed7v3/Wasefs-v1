import { canServeOnClass } from "@wasfa/shared/ads";
import { t } from "@wasfa/shared/i18n";
import { headers } from "next/headers";

import { adCountry } from "../../lib/ad-country";
import { adClassOfPath } from "../../lib/ad-route-class";
import { getAdSlot } from "../../lib/ads-server";

import { BottomBannerLazy } from "./bottom-banner-lazy";

/**
 * Server half of the bottom banner, rendered by the site and app layouts: derives the page class from
 * the request path that `proxy.ts` records, asks the API for the `global.bottom_banner` slot (the API
 * applies the switch, the admin class list, schedule, targeting and ad-free plans) and hands the
 * result to the client island. Floor classes, and a request without a recorded path, never make the
 * request.
 */
export async function BottomBannerHost({ locale = "ar" }: { locale?: "ar" | "en" }) {
  const path = (await headers()).get("x-pathname");
  if (!path) return null;
  const pageClass = adClassOfPath(path);
  if (!canServeOnClass(pageClass)) return null;
  const slot = await getAdSlot({
    placement: "global.bottom_banner",
    pageClass,
    locale,
    country: await adCountry(),
  });
  if (slot?.format !== "bottom_banner") return null;
  return (
    <BottomBannerLazy
      slot={slot}
      pageClass={pageClass}
      label={t("ads.label", undefined, locale)}
      closeLabel={t("ads.close", undefined, locale)}
    />
  );
}
