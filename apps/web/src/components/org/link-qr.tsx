"use client";

import { t } from "@wasfa/shared/i18n";
import { Skeleton } from "@wasfa/ui";
import Image from "next/image";

import { useQrCode } from "../../lib/use-qr-code";

/** A QR code of a link, drawn in the browser (the same helper as the print sheet), with its text kept beside it. */
export function LinkQr({ url, label }: { url: string; label: string }) {
  const qr = useQrCode(url, 176);
  if (!qr) return <Skeleton className="size-44" />;
  return (
    <Image
      unoptimized
      src={qr}
      alt={t("org.links.qrAlt", { name: label })}
      width={176}
      height={176}
      className="rounded-md border border-border bg-white p-1"
    />
  );
}
