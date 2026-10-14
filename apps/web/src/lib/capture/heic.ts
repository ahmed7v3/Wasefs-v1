/*
 * HEIC/HEIF photos (iPhone). Safari decodes them natively, so `prepare` tries the normal pipeline
 * first. Everywhere else the converter below is loaded ON DEMAND with a dynamic import, so the
 * ~1.3 MB library lives in its own chunk and never in the main bundle.
 */

const HEIC_NAME = /\.(heic|heif)$/i;

export function isHeicFile(file: Pick<File, "type" | "name">): boolean {
  const type = file.type.toLowerCase();
  if (type === "image/heic" || type === "image/heif") return true;
  if (type === "image/heic-sequence" || type === "image/heif-sequence") return true;
  // Some browsers and the Windows file picker leave the type empty.
  return type === "" && HEIC_NAME.test(file.name);
}

/** Converts a HEIC picture to a JPEG blob. Rejects when the file is not a readable HEIC. */
export async function convertHeicToJpeg(file: Blob): Promise<Blob> {
  const { default: heic2any } = await import("heic2any");
  const result = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
  const [first] = Array.isArray(result) ? result : [result];
  if (!first) throw new Error("heic conversion returned nothing");
  return first;
}
