"use client";

import { t } from "@wasfa/shared/i18n";
import { Card, CardTitle } from "@wasfa/ui";

import type { BrandingAsset, BrandingAssetKey } from "@wasfa/shared/schemas/branding";
import type { ReactNode } from "react";

/** Public URLs the web app serves with the bundled defaults when nothing was uploaded. */
const DEFAULT_URL: Partial<Record<BrandingAssetKey, string>> = {
  icon_48: "/icon-48.png",
  icon_192: "/icon-192.png",
  apple_touch_icon: "/apple-touch-icon.png",
  icon_maskable_512: "/icon-maskable-512.png",
  og_default: "/og/default.png",
};

export interface BrandPreviewPanelProps {
  assets: readonly BrandingAsset[];
  /** The `branding` setting's logo, the fallback of the e-mail header. */
  logoUrl: string | null;
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-semibold text-text-muted">{title}</figcaption>
      {children}
    </figure>
  );
}

/**
 * Where the icons end up (BRAND-AND-HOMEPAGE §1.4): browser tab in both themes, a search result,
 * the iOS home screen, Android's circle and squircle masks, a link card and an e-mail header. The
 * images are the stored ones, so a change shows here as soon as the list reloads. The dark tab and
 * the cards use fixed colours on purpose: they imitate other people's screens, not our theme.
 */
export function BrandPreviewPanel({ assets, logoUrl }: BrandPreviewPanelProps) {
  const urlOf = (key: BrandingAssetKey): string | null =>
    assets.find((asset) => asset.key === key)?.url ?? DEFAULT_URL[key] ?? null;
  const tabIcon = urlOf("icon_48");
  const maskable = urlOf("icon_maskable_512");
  const apple = urlOf("apple_touch_icon");
  const og = urlOf("og_default");
  const emailLogo = urlOf("email_logo") ?? logoUrl;

  const tab = (dark: boolean) => (
    <div
      className={`flex items-center gap-2 rounded-t-md px-3 py-2 ${dark ? "bg-[#35363a] text-white" : "bg-[#dee1e6] text-[#1f1f1f]"}`}
    >
      {tabIcon ? <img src={tabIcon} alt="" className="size-4" /> : null}
      <span className="truncate text-sm">{t("admin.branding.preview.siteTitle")}</span>
    </div>
  );

  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <CardTitle>{t("admin.branding.preview.title")}</CardTitle>
        <p className="text-sm text-text-muted">{t("admin.branding.preview.description")}</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Frame title={t("admin.branding.preview.tabLight")}>{tab(false)}</Frame>
        <Frame title={t("admin.branding.preview.tabDark")}>{tab(true)}</Frame>

        <Frame title={t("admin.branding.preview.google")}>
          <div dir="ltr" className="flex gap-3 rounded-md bg-white p-3 text-start text-[#202124]">
            {tabIcon ? <img src={tabIcon} alt="" className="size-7 rounded-full border" /> : null}
            <div className="flex min-w-0 flex-col">
              <span className="text-sm">{t("admin.branding.preview.siteTitle")}</span>
              <span className="text-xs text-[#4d5156]">{t("admin.branding.preview.siteUrl")}</span>
              <span className="truncate text-lg text-[#1a0dab]">
                {t("admin.branding.preview.resultTitle")}
              </span>
              <span className="text-sm text-[#4d5156]">
                {t("admin.branding.preview.resultSnippet")}
              </span>
            </div>
          </div>
        </Frame>

        <Frame title={t("admin.branding.preview.ios")}>
          <div className="grid place-items-center rounded-md bg-gradient-to-b from-sky-300 to-indigo-400 p-4">
            {apple ? <img src={apple} alt="" className="size-16 rounded-[22%] shadow-md" /> : null}
          </div>
        </Frame>

        <Frame title={t("admin.branding.preview.androidCircle")}>
          <div className="grid place-items-center rounded-md bg-neutral-200 p-4">
            {maskable ? (
              <img src={maskable} alt="" className="size-16 rounded-full shadow-md" />
            ) : null}
          </div>
        </Frame>
        <Frame title={t("admin.branding.preview.androidSquircle")}>
          <div className="grid place-items-center rounded-md bg-neutral-200 p-4">
            {maskable ? (
              <img src={maskable} alt="" className="size-16 rounded-[30%] shadow-md" />
            ) : null}
          </div>
        </Frame>

        <Frame title={t("admin.branding.preview.card")}>
          <div className="overflow-hidden rounded-md border border-border bg-white text-[#1c1e21]">
            {og ? (
              <img src={og} alt="" className="aspect-[1200/630] w-full object-cover" />
            ) : (
              <div className="grid aspect-[1200/630] place-items-center bg-neutral-100 text-sm text-text-muted">
                {t("admin.branding.preview.noImage")}
              </div>
            )}
            <div className="flex flex-col gap-0.5 bg-[#f0f2f5] p-3">
              <span className="text-xs uppercase text-[#65676b]" dir="ltr">
                {t("admin.branding.preview.siteUrl")}
              </span>
              <span className="text-base font-semibold">
                {t("admin.branding.preview.cardTitle")}
              </span>
              <span className="text-sm text-[#65676b]">{t("admin.branding.preview.cardText")}</span>
            </div>
          </div>
        </Frame>

        <Frame title={t("admin.branding.preview.email")}>
          <div className="grid h-16 place-items-center rounded-md border border-border bg-white">
            {emailLogo ? (
              <img src={emailLogo} alt="" className="max-h-10 max-w-[70%] object-contain" />
            ) : (
              <span className="text-sm text-[#65676b]">
                {t("admin.branding.preview.siteTitle")}
              </span>
            )}
          </div>
        </Frame>
      </div>
    </Card>
  );
}
