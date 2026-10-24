import { z } from "zod";

import type { SettingValue } from "../settings.js";

/*
 * Brand images (logo, dark logo, favicon) uploaded from the admin panel. The bytes live in the
 * `site_assets` table and are served by the api at `GET /assets/<key>`; `site_settings.branding`
 * holds the versioned URL. Both the api and the admin page validate with these constants.
 */

export const BRANDING_ASSET_KEYS = [
  "logo",
  "logo_dark",
  "favicon",
  // The square symbol, and the icon set rendered from it (or uploaded one by one).
  "symbol",
  "favicon_ico",
  "icon_48",
  "icon_96",
  "icon_192",
  "icon_512",
  "icon_maskable_512",
  "apple_touch_icon",
  "og_default",
  "logo_en",
  "logo_mono",
  "email_logo",
] as const;
export type BrandingAssetKey = (typeof BRANDING_ASSET_KEYS)[number];

/** Keys the worker renders from the `symbol` (BRAND-AND-HOMEPAGE §1.3); each can also be uploaded by hand. */
export const BRANDING_GENERATED_KEYS = [
  "favicon_ico",
  "icon_48",
  "icon_96",
  "icon_192",
  "icon_512",
  "icon_maskable_512",
  "apple_touch_icon",
] as const;
export type BrandingGeneratedKey = (typeof BRANDING_GENERATED_KEYS)[number];

/** Pixel sizes of each generated key (the ICO holds 16, 32 and 48). */
export const BRANDING_ICON_SIZES = {
  favicon_ico: [16, 32, 48],
  icon_48: [48],
  icon_96: [96],
  icon_192: [192],
  icon_512: [512],
  icon_maskable_512: [512],
  apple_touch_icon: [180],
} as const satisfies Record<BrandingGeneratedKey, readonly number[]>;

/** Budget of every generated icon. */
export const BRANDING_ICON_MAX_BYTES = 20_480;
/** SVG symbol size after sanitising, and the smallest side of a raster symbol. */
export const BRANDING_SYMBOL_SVG_MAX_BYTES = 10_240;
export const BRANDING_SYMBOL_MIN_SIDE = 512;
/** Previous versions kept per key, the live one not counted. */
export const BRANDING_HISTORY_KEEP = 5;

/** Raster formats plus SVG (checked by a strict denylist, see the api) and ICO for favicons. */
export const BRANDING_ASSET_TYPES = [
  "image/png",
  "image/webp",
  "image/svg+xml",
  "image/x-icon",
] as const;
export type BrandingAssetType = (typeof BRANDING_ASSET_TYPES)[number];

/** Decoded size limit. Also a CHECK on `site_assets.data`. */
export const BRANDING_ASSET_MAX_BYTES = 524_288;

/** Longest `data:<type>;base64,<payload>` for a file of the maximum size. */
const DATA_URL_MAX_LENGTH = 64 + Math.ceil(BRANDING_ASSET_MAX_BYTES / 3) * 4;

/** Characters of the sha256 hex digest used as the `?v=` cache-busting version. */
export const BRANDING_ASSET_VERSION_LENGTH = 12;

/** The `branding` setting field that holds an asset's URL; the other keys are reached at `/assets/<key>` only. */
export const BRANDING_ASSET_URL_FIELD = {
  logo: "logoUrl",
  logo_dark: "logoDarkUrl",
  favicon: "faviconUrl",
} as const satisfies Partial<Record<BrandingAssetKey, keyof SettingValue<"branding">>>;

export function brandingAssetUrlField(
  key: BrandingAssetKey,
): (typeof BRANDING_ASSET_URL_FIELD)[keyof typeof BRANDING_ASSET_URL_FIELD] | undefined {
  return Object.hasOwn(BRANDING_ASSET_URL_FIELD, key)
    ? BRANDING_ASSET_URL_FIELD[key as keyof typeof BRANDING_ASSET_URL_FIELD]
    : undefined;
}

/** `/assets/<key>?v=<first 12 of the sha256>`: immutable for as long as the bytes are the same. */
export function brandingAssetPath(key: BrandingAssetKey, sha256: string): string {
  return `/assets/${key}?v=${sha256.slice(0, BRANDING_ASSET_VERSION_LENGTH)}`;
}

export const brandingAssetParamSchema = z.object({ key: z.enum(BRANDING_ASSET_KEYS) });

/** `PUT /admin/branding/assets/:key`. The declared type is checked against the bytes by the api. */
export const putBrandingAssetSchema = z.object({
  dataUrl: z
    .string()
    .max(DATA_URL_MAX_LENGTH)
    .regex(/^data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/),
});
export type PutBrandingAssetInput = z.infer<typeof putBrandingAssetSchema>;

/** `GET /assets/:key?v=`: `v` only decides the cache lifetime, a wrong one is harmless. */
export const brandingAssetQuerySchema = z.object({ v: z.string().max(64).optional() });

export const brandingAssetSchema = z.object({
  key: z.enum(BRANDING_ASSET_KEYS),
  contentType: z.enum(BRANDING_ASSET_TYPES),
  size: z.number().int().min(1).max(BRANDING_ASSET_MAX_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().min(1).nullable(),
  height: z.number().int().min(1).nullable(),
  url: z.string(),
});
export type BrandingAsset = z.infer<typeof brandingAssetSchema>;

/** Non-blocking findings about an upload, shown next to the success message. */
export const BRANDING_WARNINGS = ["low_contrast"] as const;

/** Response of `PUT /admin/branding/assets/:key` and of `revert`. */
export const putBrandingAssetResponseSchema = brandingAssetSchema.extend({
  warnings: z.array(z.enum(BRANDING_WARNINGS)),
  /** True while icons are being rendered from a new symbol. */
  generating: z.boolean(),
});
export type PutBrandingAssetResponse = z.infer<typeof putBrandingAssetResponseSchema>;

/** `GET /admin/branding/assets`: what is stored per key, without the bytes. */
export const brandingAssetListSchema = z.object({
  items: z.array(brandingAssetSchema.extend({ updatedAt: z.string() })),
  /** Archived versions per key (also for a key whose live version was deleted): what `revert` can take back. */
  history: z.partialRecord(z.enum(BRANDING_ASSET_KEYS), z.number().int().min(1)),
});
export type BrandingAssetList = z.infer<typeof brandingAssetListSchema>;

/** Payload of the worker job `branding.icons` (queue `images`). */
export const brandingIconsPayloadSchema = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) });
