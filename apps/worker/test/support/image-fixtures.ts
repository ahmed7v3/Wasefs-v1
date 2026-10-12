import { deflateSync, crc32 } from "node:zlib";

import sharp, { type Exif } from "sharp";

/*
 * Fixtures are generated in the test, never checked in: every file is a few hundred bytes or built
 * from `sharp`, and the hostile ones are spelled out so the test says what makes them hostile.
 */

/** Left half red, right half blue, `width` x `height` (landscape when width > height). */
export async function twoToneJpeg(
  width: number,
  height: number,
  options: { orientation?: number; exif?: Exif } = {},
): Promise<Buffer> {
  const half = width / 2;
  const red = await sharp({
    create: { width: half, height, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  let image = sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 255 } },
  }).composite([{ input: red, left: 0, top: 0 }]);
  if (options.exif !== undefined) image = image.withExif(options.exif);
  if (options.orientation !== undefined)
    image = image.withMetadata({ orientation: options.orientation });
  return image.jpeg({ quality: 95 }).toBuffer();
}

export function solidPng(width: number, height: number, alpha = 1): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 10, g: 120, b: 60, alpha } },
  })
    .png()
    .toBuffer();
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/**
 * A valid PNG that *declares* 20,000 x 20,000 pixels (400 MP, 1.2 GB decoded) and holds a few
 * hundred bytes of compressed data: the classic decompression bomb. A decoder that trusts the
 * header allocates the memory; ours must refuse before decoding.
 */
export function pngBomb(side = 20_000): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // truecolour
  const row = Buffer.alloc(1 + side * 3); // filter byte + RGB, all zero
  const idat = deflateSync(Buffer.concat(Array.from({ length: 64 }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A PDF whose pages each paint a coloured rectangle (no fonts, so nothing depends on font files). */
export function pdfWithPages(
  count: number,
  size: { width: number; height: number } = { width: 595, height: 842 },
): Buffer {
  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);
  add("<< /Type /Catalog /Pages 2 0 R >>");
  const firstPage = 3;
  const kids = Array.from({ length: count }, (_, index) => `${String(firstPage + index * 2)} 0 R`);
  add(`<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${String(count)} >>`);
  for (let index = 0; index < count; index++) {
    const content = 4 + index * 2;
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(size.width)} ${String(size.height)}] /Contents ${String(content)} 0 R /Resources << >> >>`,
    );
    const stream = `0.9 0.1 0.1 rg 40 40 ${String(size.width - 80)} ${String(size.height / 2)} re f`;
    add(`<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`);
  }
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${String(index + 1)} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
