import { create } from "qrcode";

/**
 * A QR code rendered on the server as inline SVG (one path of horizontal runs): the `qrcode` package
 * stays out of every client bundle and the code works without JavaScript. The value is a public
 * `wa.me` link, so nothing private is encoded.
 */
export function QrSvg({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const { size, data } = create(value, { errorCorrectionLevel: "M" }).modules;
  const quiet = 2;
  let path = "";
  for (let y = 0; y < size; y += 1) {
    let x = 0;
    while (x < size) {
      if (!data[y * size + x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < size && data[y * size + x]) x += 1;
      path += `M${start + quiet} ${y + quiet}h${x - start}v1h-${x - start}z`;
    }
  }
  const box = size + quiet * 2;
  return (
    <svg
      viewBox={`0 0 ${box} ${box}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={box} height={box} fill="#fff" />
      <path d={path} fill="#0b1220" />
    </svg>
  );
}
