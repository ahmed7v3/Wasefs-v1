import { BRANDING_ICON_MAX_BYTES, BRANDING_GENERATED_KEYS } from "@wasfa/shared/schemas/branding";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { buildIco, renderIcons } from "../src/branding/render-icons.js";

const SYMBOL = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#ff0000"/></svg>',
);

describe("renderIcons", () => {
  it("renders every key, each within 20 KB, at the sizes of the spec", async () => {
    const icons = await renderIcons(SYMBOL, "#1e3a8a");
    expect(icons.map((icon) => icon.key).sort()).toEqual([...BRANDING_GENERATED_KEYS].sort());
    const sizes: Record<string, number> = {
      icon_48: 48,
      icon_96: 96,
      icon_192: 192,
      icon_512: 512,
      icon_maskable_512: 512,
      apple_touch_icon: 180,
    };
    for (const icon of icons) {
      expect(icon.data.length, icon.key).toBeLessThanOrEqual(BRANDING_ICON_MAX_BYTES);
      const size = sizes[icon.key];
      if (size === undefined) continue;
      const meta = await sharp(icon.data).metadata();
      expect([meta.format, meta.width, meta.height], icon.key).toEqual(["png", size, size]);
    }
  });

  it("writes an ICO with 16, 32 and 48 px PNG images", async () => {
    const ico = (await renderIcons(SYMBOL, "#1e3a8a")).find((icon) => icon.key === "favicon_ico");
    expect(ico?.contentType).toBe("image/x-icon");
    const data = ico?.data ?? Buffer.alloc(0);
    expect([data.readUInt16LE(0), data.readUInt16LE(2), data.readUInt16LE(4)]).toEqual([0, 1, 3]);
    const entries = [0, 1, 2].map((index) => {
      const at = 6 + index * 16;
      const png = data.subarray(
        data.readUInt32LE(at + 12),
        data.readUInt32LE(at + 12) + data.readUInt32LE(at + 8),
      );
      return { declared: data[at], png };
    });
    expect(entries.map((entry) => entry.declared)).toEqual([16, 32, 48]);
    for (const entry of entries) {
      const meta = await sharp(entry.png).metadata();
      expect([meta.format, meta.width]).toEqual(["png", entry.declared]);
    }
  });

  it("keeps the symbol transparent, and puts it on an opaque tile for apple and maskable", async () => {
    const icons = await renderIcons(SYMBOL, "#1e3a8a");
    const pixel = async (key: string, x: number, y: number) => {
      const icon = icons.find((candidate) => candidate.key === key);
      const { data, info } = await sharp(icon?.data)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const at = (y * info.width + x) * 4;
      return [...data.subarray(at, at + 4)];
    };
    expect((await pixel("icon_192", 0, 0))[3]).toBe(0);
    expect(await pixel("icon_192", 96, 96)).toEqual([255, 0, 0, 255]);
    expect(await pixel("apple_touch_icon", 0, 0)).toEqual([0x1e, 0x3a, 0x8a, 255]);
    expect(
      (await sharp(icons.find((i) => i.key === "apple_touch_icon")?.data).metadata()).hasAlpha,
    ).toBe(false);
    expect(await pixel("icon_maskable_512", 0, 0)).toEqual([0x1e, 0x3a, 0x8a, 255]);
    // the symbol's edge stays inside the 80 % safe zone: 10 % margin of 512 = 51 px
    expect(await pixel("icon_maskable_512", 40, 256)).toEqual([0x1e, 0x3a, 0x8a, 255]);
    expect(await pixel("icon_maskable_512", 256, 256)).toEqual([255, 0, 0, 255]);
  });

  it("renders a raster symbol too", async () => {
    const raster = await sharp({
      create: {
        width: 600,
        height: 600,
        channels: 4,
        background: { r: 0, g: 128, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const icons = await renderIcons(raster, "#112233");
    expect(icons).toHaveLength(BRANDING_GENERATED_KEYS.length);
  });

  it("refuses a symbol it cannot decode", async () => {
    await expect(renderIcons(Buffer.from("not an image"), "#112233")).rejects.toThrow();
  });
});

describe("buildIco", () => {
  it("lays out header, directory and images back to back", () => {
    const a = Buffer.from("aaaa");
    const b = Buffer.from("bb");
    const ico = buildIco([
      { size: 16, png: a },
      { size: 256, png: b },
    ]);
    expect(ico.readUInt16LE(4)).toBe(2);
    expect(ico[6]).toBe(16);
    expect(ico[22]).toBe(0); // 256 is written as 0
    expect(ico.readUInt32LE(6 + 12)).toBe(38);
    expect(ico.subarray(38).toString()).toBe("aaaabb");
  });
});
