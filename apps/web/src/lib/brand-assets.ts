import {
  BRANDING_ASSET_MAX_BYTES,
  BRANDING_ASSET_TYPES,
  type BrandingAssetKey,
  type BrandingAssetType,
} from "@wasfa/shared/schemas/branding";

/*
 * Browser-side checks of a brand image before it is uploaded. They only save a round trip: the api
 * re-checks the type against the file's bytes, the size, and SVG content, and is the authority.
 */

/** The two images the admin page offers. (The api also takes `logo_dark`, unused while the site is light only.) */
export type EditableAssetKey = Extract<BrandingAssetKey, "logo" | "favicon">;

/** `.ico` files often arrive with the Windows MIME type or none at all. */
const EXTENSION_TYPES: Record<string, BrandingAssetType> = {
  png: "image/png",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
};

/** Mirrors the api's per-key rules (the api decides; this only saves a round trip). */
const PNG_ONLY: readonly BrandingAssetType[] = ["image/png"];
const KEY_TYPES: Partial<Record<BrandingAssetKey, readonly BrandingAssetType[]>> = {
  favicon: BRANDING_ASSET_TYPES,
  favicon_ico: ["image/x-icon"],
  icon_48: PNG_ONLY,
  icon_96: PNG_ONLY,
  icon_192: PNG_ONLY,
  icon_512: PNG_ONLY,
  icon_maskable_512: PNG_ONLY,
  apple_touch_icon: PNG_ONLY,
  email_logo: PNG_ONLY,
  og_default: ["image/png", "image/webp"],
};

export function allowedTypes(key: BrandingAssetKey): readonly BrandingAssetType[] {
  return KEY_TYPES[key] ?? BRANDING_ASSET_TYPES.filter((type) => type !== "image/x-icon");
}

/** The value of the file input's `accept` attribute. */
export function acceptAttribute(key: BrandingAssetKey): string {
  const extensions = Object.entries(EXTENSION_TYPES)
    .filter(([, type]) => allowedTypes(key).includes(type))
    .map(([extension]) => `.${extension}`);
  return [...allowedTypes(key), ...extensions].join(",");
}

function typeOf(file: File): BrandingAssetType | undefined {
  const declared = file.type === "image/vnd.microsoft.icon" ? "image/x-icon" : file.type;
  const known = BRANDING_ASSET_TYPES.find((type) => type === declared);
  if (known) return known;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return Object.hasOwn(EXTENSION_TYPES, extension) ? EXTENSION_TYPES[extension] : undefined;
}

export type AssetFileCheck =
  { ok: true; type: BrandingAssetType } | { ok: false; reason: "type" | "size" };

export function checkAssetFile(key: BrandingAssetKey, file: File): AssetFileCheck {
  const type = typeOf(file);
  if (type === undefined || file.size === 0 || !allowedTypes(key).includes(type)) {
    return { ok: false, reason: "type" };
  }
  if (file.size > BRANDING_ASSET_MAX_BYTES) return { ok: false, reason: "size" };
  return { ok: true, type };
}

/** `data:<type>;base64,<payload>` with the type we decided on, not whatever the browser guessed. */
export function readAsDataUrl(file: File, type: BrandingAssetType): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new Error("read failed"));
    };
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("read failed"));
        return;
      }
      resolve(`data:${type};base64,${result.slice(result.indexOf(",") + 1)}`);
    };
    reader.readAsDataURL(file);
  });
}
