import { t } from "@wasfa/shared/i18n/public";
import { LoaderCircle } from "lucide-react";

import { cn } from "./cn";

export interface SpinnerProps {
  className?: string | undefined;
  /** Hide it from assistive tech when the parent already announces the busy state (e.g. `aria-busy`). */
  decorative?: boolean | undefined;
}

/** Looping spinner; the reduced-motion rule in globals.css stops the rotation. */
export function Spinner({ className, decorative = false }: SpinnerProps) {
  return (
    <span
      className="inline-flex"
      {...(decorative ? { "aria-hidden": true } : { role: "status" as const })}
    >
      <LoaderCircle aria-hidden className={cn("size-5 animate-spin", className)} />
      {decorative ? null : <span className="sr-only">{t("ui.loading")}</span>}
    </span>
  );
}
