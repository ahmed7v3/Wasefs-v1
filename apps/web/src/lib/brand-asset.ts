import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { serverEnv } from "./server-env";

/**
 * The favicon / app-icon files live at stable URLs (`/favicon.ico`, `/icon-192.png`, ...) so Google
 * and browsers keep one address while the admin changes the image. Each is served from the api's
 * `GET /assets/<key>` when the admin uploaded one, and from the bundled default otherwise.
 */
export interface BrandAssetSpec {
  /** Key of the admin override in `site_assets`. */
  key: string;
  /** File under `src/brand-defaults/` served when there is no usable override. */
  file: string;
  /** Content type of the bundled default. */
  contentType: string;
  /** Content types an override may have; anything else is ignored in favour of the default. */
  overrideTypes: readonly string[];
}

const PNG = ["image/png"] as const;

export const BRAND_ASSETS = {
  favicon: {
    key: "favicon_ico",
    file: "favicon.ico",
    contentType: "image/x-icon",
    overrideTypes: ["image/x-icon", "image/vnd.microsoft.icon", "image/png"],
  },
  icon: {
    key: "symbol",
    file: "icon.svg",
    contentType: "image/svg+xml",
    overrideTypes: ["image/svg+xml"],
  },
  icon48: { key: "icon_48", file: "icon-48.png", contentType: "image/png", overrideTypes: PNG },
  icon96: { key: "icon_96", file: "icon-96.png", contentType: "image/png", overrideTypes: PNG },
  icon192: { key: "icon_192", file: "icon-192.png", contentType: "image/png", overrideTypes: PNG },
  icon512: { key: "icon_512", file: "icon-512.png", contentType: "image/png", overrideTypes: PNG },
  iconMaskable512: {
    key: "icon_maskable_512",
    file: "icon-maskable-512.png",
    contentType: "image/png",
    overrideTypes: PNG,
  },
  appleTouchIcon: {
    key: "apple_touch_icon",
    file: "apple-touch-icon.png",
    contentType: "image/png",
    overrideTypes: PNG,
  },
} as const satisfies Record<string, BrandAssetSpec>;

export const BRAND_ASSET_OVERRIDE_TIMEOUT_MS = 2_000;
const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

interface Resolved {
  bytes: Uint8Array;
  contentType: string;
}

/** The admin's upload, or null for "none / not an acceptable type / api unreachable". */
async function fetchOverride(spec: BrandAssetSpec): Promise<Resolved | null> {
  try {
    const response = await fetch(`${serverEnv.API_INTERNAL_URL}/assets/${spec.key}`, {
      next: { revalidate: 300, tags: ["branding"] },
      signal: AbortSignal.timeout(BRAND_ASSET_OVERRIDE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
    if (!spec.overrideTypes.includes(contentType)) return null;
    return { bytes: new Uint8Array(await response.arrayBuffer()), contentType };
  } catch {
    return null;
  }
}

async function bundledDefault(spec: BrandAssetSpec): Promise<Resolved> {
  // `process.cwd()` is the web app's directory both under `next start` and in the standalone image,
  // and Next's file tracing copies what is read this way into the standalone output.
  const file = path.join(process.cwd(), "src", "brand-defaults", spec.file);
  return { bytes: new Uint8Array(await readFile(file)), contentType: spec.contentType };
}

/** `If-None-Match` may list several tags, weak ones (`W/`) included, or `*`. */
function matches(header: string | null, etag: string): boolean {
  if (header === null) return false;
  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag);
}

/** Short content hash used as the ETag: first 16 hex characters of the sha256 of the bytes. */
export function brandEtag(bytes: Uint8Array): string {
  return `"${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}"`;
}

/** The response for one icon URL: override first, bundled default otherwise, 304 when unchanged. */
export async function brandAssetResponse(
  request: Request,
  spec: BrandAssetSpec,
): Promise<Response> {
  const { bytes, contentType } = (await fetchOverride(spec)) ?? (await bundledDefault(spec));
  const etag = brandEtag(bytes);
  const headers: Record<string, string> = {
    "Cache-Control": CACHE_CONTROL,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  };
  if (matches(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  // A copy into a plain ArrayBuffer keeps the body type simple for `Response`.
  return new Response(bytes.slice().buffer, {
    headers: { ...headers, "Content-Type": contentType, "Content-Length": String(bytes.length) },
  });
}
