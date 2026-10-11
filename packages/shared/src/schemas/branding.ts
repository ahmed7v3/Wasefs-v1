import { z } from "zod";

import type { SettingValue } from "../settings.js";

/*
 * Brand images (logo, dark logo, favicon) uploaded from the admin panel. The bytes live in the
 * `site_assets` table and are served by the api at `GET /assets/<key>`; `site_settings.branding`
 * holds the versioned URL. Both the api and the admin page validate with these constants.
 */

export const BRANDING_ASSET_KEYS = ["logo", "logo_dark", "favicon"] as const;
export type BrandingAssetKey = (typeof BRANDING_ASSET_KEYS)[number];

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

/** The `branding` setting field that holds each asset's URL. */
export const BRANDING_ASSET_URL_FIELD = {
  logo: "logoUrl",
  logo_dark: "logoDarkUrl",
  favicon: "faviconUrl",
} as const satisfies Record<BrandingAssetKey, keyof SettingValue<"branding">>;

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
