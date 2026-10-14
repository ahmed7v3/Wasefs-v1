import { t } from "@wasfa/shared/i18n";
import { ImagePlus } from "lucide-react";

export interface DropOverlayProps {
  visible: boolean;
}

/**
 * Calm full-page cue while a file is dragged over the window. It never receives events itself
 * (`pointer-events-none`): the surface listens on the window, so a drop anywhere works. Hidden from
 * assistive tech because the live region says the same in words.
 */
export function DropOverlay({ visible }: DropOverlayProps) {
  if (!visible) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="drop-overlay"
      className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-primary/10 p-gutter backdrop-blur-sm"
    >
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-surface p-8 text-center shadow-raised">
        <span className="inline-flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
          <ImagePlus className="size-7" />
        </span>
        <p className="font-heading text-2xl font-bold text-primary">{t("capture.drop.title")}</p>
        <p className="text-base text-text-muted">{t("capture.drop.hint")}</p>
      </div>
    </div>
  );
}
