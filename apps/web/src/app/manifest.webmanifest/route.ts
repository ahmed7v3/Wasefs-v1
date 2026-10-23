import { getPublicSettings } from "../../lib/public-settings";

/** Colour of the splash screen an installed app shows while it loads. */
const BACKGROUND_COLOR = "#ffffff";

// Per request: a build-time render would bake in the defaults of an unreachable API.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { branding } = await getPublicSettings();
  const manifest = {
    name: branding.manifestName,
    short_name: branding.manifestShortName,
    lang: "ar",
    dir: "rtl",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: BACKGROUND_COLOR,
    theme_color: branding.themeColor,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
