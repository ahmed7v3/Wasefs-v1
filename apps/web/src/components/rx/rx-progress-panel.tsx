import { t } from "@wasfa/shared/i18n";
import { RX_STEPS } from "@wasfa/shared/schemas/rx";
import { buttonStyles, Card, StepProgress } from "@wasfa/ui";
import { CircleCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";

import type { RxProgressState } from "../../lib/rx-progress";

const STEPS = RX_STEPS.map((id) => ({ id, label: t(`rx.step.${id}`) }));

export interface RxProgressPanelProps {
  progress: RxProgressState;
  elapsed: number | undefined;
}

/** The running state: four calm steps, the clock and the promise that leaving the page is safe. */
export function RxProgressPanel({ progress, elapsed }: RxProgressPanelProps) {
  return (
    <Card
      elevation="raised"
      data-testid="rx-progress"
      aria-busy="true"
      className="flex flex-col gap-4"
    >
      <h2 className="font-heading text-xl font-semibold text-text">{t("rx.progress.title")}</h2>
      <StepProgress
        steps={STEPS}
        current={progress.step}
        elapsedSeconds={elapsed}
        note={t("rx.leaveHint")}
      />
      {progress.transport === "polling" ? (
        <p role="status" className="text-sm text-text-muted">
          {t("rx.progress.polling")}
        </p>
      ) : null}
    </Card>
  );
}

/** Zero readable lines: refunded in full, with guidance on a better photo. */
export function RxRefunded() {
  return (
    <Card data-testid="rx-refunded" className="flex flex-col items-start gap-4">
      <div className="flex items-start gap-3">
        <CircleCheck aria-hidden className="mt-1 size-6 shrink-0 text-primary" />
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-xl font-semibold text-text">{t("rx.refunded.title")}</h2>
          <p className="text-base text-text-muted">{t("rx.empty.guidance")}</p>
        </div>
      </div>
      <Link href="/analyze" className={buttonStyles({})}>
        {t("rx.page.new")}
      </Link>
    </Card>
  );
}

/** The analysis failed: nothing was charged; the reference helps support find it. */
export function RxFailed({ errorRef }: { errorRef: string | null }) {
  return (
    <Card data-testid="rx-failed" role="alert" className="flex flex-col items-start gap-4">
      <div className="flex items-start gap-3">
        <TriangleAlert aria-hidden className="mt-1 size-6 shrink-0 text-danger" />
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-xl font-semibold text-text">{t("rx.failed.title")}</h2>
          <p className="text-base text-text-muted">{t("rx.failed")}</p>
        </div>
      </div>
      {errorRef ? (
        <p className="w-fit rounded-md bg-danger-soft px-3 py-1 text-sm font-semibold text-danger">
          {t("common.errorRef", { ref: errorRef })}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/analyze" className={buttonStyles({})}>
          {t("rx.page.new")}
        </Link>
        <Link href="/contact" className={buttonStyles({ variant: "ghost" })}>
          {t("common.contactSupport")}
        </Link>
      </div>
    </Card>
  );
}
