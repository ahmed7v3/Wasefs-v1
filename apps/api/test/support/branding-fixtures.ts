/** Smallest bytes the api accepts as each type: real headers, no pixels (only the header is read). */
export function png(width = 240, height = 80): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "latin1");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header.writeUInt8(8, 24); // bit depth
  header.writeUInt8(6, 25); // RGBA
  return header;
}

/** A lossless-extended (VP8X) WebP header. */
export function webp(width = 300, height = 100): Buffer {
  const data = Buffer.alloc(30);
  data.write("RIFF", 0, "latin1");
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WEBP", 8, "latin1");
  data.write("VP8X", 12, "latin1");
  data.writeUInt32LE(10, 16);
  data.writeUIntLE(width - 1, 24, 3);
  data.writeUIntLE(height - 1, 27, 3);
  return data;
}

export function ico(): Buffer {
  const data = Buffer.alloc(22);
  data.writeUInt16LE(0, 0);
  data.writeUInt16LE(1, 2); // type: icon
  data.writeUInt16LE(1, 4); // one image
  return data;
}

export const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<!-- a plain logo -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 60">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#1d4ed8"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient></defs>
  <style>.t { fill: url(#g); font-family: sans-serif; }</style>
  <rect width="200" height="60" rx="8" fill="url('#g')"/>
  <use xlink:href="#g"/>
  <text class="t" x="10" y="38">Wasfa &amp; co</text>
</svg>`;

export const MALICIOUS_SVGS: Record<string, string> = {
  "script element": `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
  "script with whitespace": `<svg xmlns="http://www.w3.org/2000/svg">< script>alert(1)</script></svg>`,
  "event handler": `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>`,
  "event handler in a child": `<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" OnClick = "alert(1)"/></svg>`,
  "event handler after a slash": `<svg/onload=alert(1) xmlns="http://www.w3.org/2000/svg"></svg>`,
  "javascript: link": `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>`,
  "javascript: written as character references": `<svg xmlns="http://www.w3.org/2000/svg"><a href="&#106;avascript&#x3a;alert(1)"><rect width="1" height="1"/></a></svg>`,
  foreignObject: `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>hi</div></foreignObject></svg>`,
  "external href": `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x.png" width="1" height="1"/></svg>`,
  "external xlink:href": `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="https://example.com/a.svg#b"/></svg>`,
  "relative href": `<svg xmlns="http://www.w3.org/2000/svg"><use href="other.svg#b"/></svg>`,
  "embedded data href": `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AAAA" width="1" height="1"/></svg>`,
  "animated href": `<svg xmlns="http://www.w3.org/2000/svg"><a href="#x"><set attributeName="href" to="javascript:1"/></a></svg>`,
  "css import": `<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(#x);</style></svg>`,
  "css external url": `<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" style="fill:url(https://example.com/x)"/></svg>`,
  "entity declaration": `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "boom">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>`,
  doctype: `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"/>`,
  "stylesheet instruction": `<?xml version="1.0"?><?xml-stylesheet href="https://example.com/a.css"?><svg xmlns="http://www.w3.org/2000/svg"/>`,
  iframe: `<svg xmlns="http://www.w3.org/2000/svg"><iframe src="#"></iframe></svg>`,
};

export const MALFORMED_SVGS: Record<string, string> = {
  "not xml at all": "just some text",
  "html root": `<html><body></body></html>`,
  "text before the root": `hello <svg xmlns="http://www.w3.org/2000/svg"/>`,
  "unclosed tag": `<svg xmlns="http://www.w3.org/2000/svg"><g></svg>`,
  "mismatched tags": `<svg xmlns="http://www.w3.org/2000/svg"><g></h></svg>`,
  "two roots": `<svg xmlns="http://www.w3.org/2000/svg"/><svg xmlns="http://www.w3.org/2000/svg"/>`,
  "unquoted attribute": `<svg xmlns=http://www.w3.org/2000/svg/>`,
  "duplicate attribute": `<svg width="1" width="2"/>`,
  "unterminated comment": `<svg><!-- oops </svg>`,
};

export function dataUrl(type: string, data: Buffer | string): string {
  return `data:${type};base64,${Buffer.from(data).toString("base64")}`;
}

/** A PNG-looking file of exactly `size` bytes (header, then zeros). */
export function pngOfSize(size: number): Buffer {
  const header = png();
  return Buffer.concat([header, Buffer.alloc(size - header.length)]);
}
