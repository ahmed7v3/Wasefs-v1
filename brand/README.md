# Brand masters

SVG masters of the Wasfa AI mark (direction A, the default until the owner picks one: open question O3). Served copies live in `apps/web/public/brand/`; raster icons are bundled defaults in `apps/web/src/brand-defaults/` (served by route handlers at stable URLs, with the admin upload taking precedence).

| File                                   | Use                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `symbol.svg`                           | 24x24 symbol: navy tile, white و whose tail becomes a check                                      |
| `logo-ar.svg`, `logo-en.svg`           | lockups (symbol + «وصفة AI» / "Wasfa AI")                                                        |
| `logo-ar-mono.svg`, `logo-en-mono.svg` | single colour, `currentColor`                                                                    |
| `logo-ar-dark.svg`                     | white wordmark for dark surfaces                                                                 |
| `directions/`                          | the three drafts (A, B, C) and `index.html`, a static preview at 16/32/64/180 px, light and dark |
| `wasfa-doctor-character.svg`           | mascot illustration, not the logo                                                                |

The wordmarks are IBM Plex Sans Arabic Bold (OFL) converted to outlines, so the SVGs have no font dependency. The Arabic glyphs use the font's own contextual forms (initial/medial/final) chosen by opentype.js; the script places them by advance width.

## Regenerate

Nothing here is added to a package.json. opentype.js runs from a temp dir and the font is downloaded into another one.

```sh
mkdir -p /tmp/wasfa-font /tmp/wasfa-ot
curl -fsSL -o /tmp/wasfa-font/IBMPlexSansArabic-Bold.ttf \
  https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexsansarabic/IBMPlexSansArabic-Bold.ttf
(cd /tmp/wasfa-ot && echo '{"name":"ot","type":"module"}' > package.json && pnpm add opentype.js)

# masters (brand/*.svg, apps/web/public/brand/*.svg) and direction drafts (brand/directions/*.svg)
node brand/scripts/outline-wordmark.mjs /tmp/wasfa-font/IBMPlexSansArabic-Bold.ttf \
  /tmp/wasfa-ot/node_modules/opentype.js/dist/opentype.mjs

# rasters: apps/web/src/brand-defaults/*, apps/web/public/logo.png (uses sharp from the worker package)
pnpm --filter @wasfa/worker exec node ../../brand/scripts/build-icons.mjs
```

`build-icons.mjs` fails if an icon exceeds 20 KB. Preview the directions by opening `brand/directions/index.html` in a browser.
