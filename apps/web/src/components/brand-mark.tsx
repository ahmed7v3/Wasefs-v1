import { t } from "@wasfa/shared/i18n";
import { Pill } from "lucide-react";
import Link from "next/link";

/** Logo chip plus name, linking home. */
export function BrandMark() {
  return (
    <Link
      href="/"
      className="inline-flex min-h-11 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:shadow-focus"
    >
      <span className="grid size-11 place-items-center rounded-lg bg-primary text-on-primary shadow-card">
        <Pill className="size-6" aria-hidden="true" />
      </span>
      <span className="font-heading text-2xl font-bold text-primary">{t("brand.name")}</span>
    </Link>
  );
}
