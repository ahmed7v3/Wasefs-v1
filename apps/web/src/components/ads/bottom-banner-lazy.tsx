"use client";

import dynamic from "next/dynamic";

// The banner only paints after a storage check in an effect anyway, so it is fetched after the page
// instead of adding its code and the impression beacon to the first load of every public page.
export const BottomBannerLazy = dynamic(
  () => import("./bottom-banner").then((module) => module.BottomBanner),
  { ssr: false },
);
