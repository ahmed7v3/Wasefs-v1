# OG / X cards

Worker-side renderer for the 1200x630 social cards (BRAND-AND-HOMEPAGE §2.1, CONTENT-PLATFORM §5.6).
`renderOgCard(template, input, assets?)` returns `{ png, hash }`; the `og.render` job (queue `images`)
stores the PNG at `og/<template>/<hash>.png` in the public media bucket unless it is already there.
`pnpm --filter @wasfa/worker og:static` regenerates `apps/web/public/og/*.png` through the `page` template.

## Spike result: Arabic shaping

Both methods shape Arabic correctly in sharp 0.35.5 (bundled libvips, Pango/HarfBuzz and librsvg):
letters join, marks (ٍ ً) sit right, and `BID — مرتين يوميًا` comes out in correct bidi order.

- Chosen: **SVG text rendered by librsvg**, with the bundled IBM Plex Sans Arabic made visible to
  fontconfig by a generated `FONTCONFIG_FILE` (`fonts.ts`, set before the first render, only the
  bundled directory, so output does not depend on host fonts).
- Quirk: librsvg follows SVG 1.1, where `text-anchor` is relative to `direction`. Right-aligned
  Arabic is therefore `direction="rtl"` + `text-anchor="start"` at the right edge (`end` pushes the
  text off the card). `frame.ts#textEl` resolves the four direction x alignment cases.
- Widths for line fitting come from `sharp({ text: { fontfile } })` (Pango, same font), see
  `fonts.ts#measureText`. `sharp({ text })` has no `rtl` option; Pango picks the direction itself.
- The Playwright fallback was not needed.

## Assets

- Fonts: `apps/worker/assets/fonts` (IBM Plex Sans Arabic Regular and Bold, OFL). The worker image
  copies this directory (`infra/docker/worker.Dockerfile`).
- Brand mark: `src/og/assets/symbol.svg` is a replaceable SVG (`viewBox` square); its width, height, x
  and y are overridden when embedded. The image also copies `src/og/assets` to `/app/src/og/assets`
  because `tsc` does not emit the SVG into `dist`. The file's content is part of every card hash.

## Changing a template

Bump the template's `version` (or `FRAME_VERSION` in `frame.ts` for the shared frame): it is part of
the hash, so the next render writes a new object. Update the snapshots in `test/__og__` with
`OG_UPDATE=1 pnpm --filter @wasfa/worker exec vitest run test/og.render.test.ts` and look at them.
