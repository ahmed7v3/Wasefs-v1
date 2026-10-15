"use client";

import { t } from "@wasfa/shared/i18n";
import {
  rxCorrectionResponseSchema,
  type RxResult,
  type RxResultItem,
  type RxView,
} from "@wasfa/shared/schemas/rx";
import {
  buttonStyles,
  drugTitle,
  ImageViewer,
  RxTable,
  Skeleton,
  useToast,
  type PickedCorrection,
  type PickerCandidate,
  type ViewerRegion,
} from "@wasfa/ui";
import { ChevronDown, ChevronUp, History, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../lib/api-client";
import { extractErrorRef } from "../../lib/api-error";
import { optimisticDrugCorrection, type RxPick } from "../../lib/rx-optimistic";
import { useRxAnalysis } from "../../lib/use-rx-analysis";
import { useRxImages } from "../../lib/use-rx-images";
import { ErrorNotice, errorMessage } from "../error-notice";

import { RxActions } from "./rx-actions";
import { RxDisclaimer, RxNotices } from "./rx-notices";
import { RxOverview } from "./rx-overview";
import { RxPrintSheet, type RxPrintSheetProps } from "./rx-print-sheet";
import { RxFailed, RxProgressPanel, RxRefunded } from "./rx-progress-panel";
import { RxRating } from "./rx-rating";
import { RxReview } from "./rx-review";

export interface RxResultViewProps {
  initial: RxView;
  /** Credits per page, from the public `rx` setting. */
  creditsPerPage: number;
  /** The wallet balance, or `null` when it could not be read. */
  balance: number | null;
  /** The `branding` public setting (the printed report carries its logo). */
  branding?: RxPrintSheetProps["branding"];
  /** The site address printed and shared with every report. */
  siteUrl: string;
}

const regionId = (index: number): string => `item-${String(index)}`;
const indexOfRegion = (id: string | null): number | null => {
  if (id === null || !id.startsWith("item-")) return null;
  const index = Number(id.slice("item-".length));
  return Number.isInteger(index) ? index : null;
};

/**
 * The /analyze/[id] screen. While the analysis runs it shows the steps; when it ends it shows the
 * refund or failure guidance, or the result: the picture with the boxes on the inline-start side
 * (a collapsible strip on top at phone width) and the table on the other. Hovering, focusing or
 * tapping a row outlines its box; tapping a box selects its row. A correction changes the row at
 * once and is confirmed (or rolled back) by the API.
 */
export function RxResultView({
  initial,
  creditsPerPage,
  balance,
  branding,
  siteUrl,
}: RxResultViewProps) {
  const { toast } = useToast();
  const { view, progress, elapsed, loadError, retryLoad } = useRxAnalysis(initial);
  const [corrected, setCorrected] = useState<RxResult | null>(null);
  const [overlay, setOverlay] = useState<Record<number, RxResultItem>>({});
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [imageOpen, setImageOpen] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const container = useRef<HTMLDivElement>(null);

  const result = corrected ?? view.result;
  const items = useMemo<RxResultItem[]>(
    () => (result ? result.items.map((item, index) => overlay[index] ?? item) : []),
    [result, overlay],
  );
  const pending = useMemo(() => new Set(Object.keys(overlay).map(Number)), [overlay]);
  const images = useRxImages(view.files, result !== null);

  const activeIndex = hoverIndex ?? selectedIndex;
  const modelOnly = result?.matching === "model";
  // Today, in Arabic words with Western digits (DESIGN-SYSTEM section 4).
  const reportDate = useMemo(
    () =>
      new Intl.DateTimeFormat("ar", { dateStyle: "long", numberingSystem: "latn" }).format(
        new Date(),
      ),
    [],
  );

  const regions = useMemo<ViewerRegion[]>(() => {
    if (!result) return [];
    const itemRegions = items.flatMap((item, index): ViewerRegion[] =>
      item.box_2d
        ? [
            {
              id: regionId(index),
              page: item.page,
              box: item.box_2d,
              label: t("rx.viewer.region", { name: drugTitle(item, modelOnly) }),
            },
          ]
        : [],
    );
    const unreadable = result.unreadableRegions.map((region, index): ViewerRegion => ({
      id: `unreadable-${String(index)}`,
      page: region.page,
      box: region.box_2d,
      label: t("rx.viewer.unreadableRegion"),
      kind: "unreadable",
    }));
    return [...itemRegions, ...unreadable];
  }, [result, items, modelOnly]);

  // One polite announcement when the analysis ends.
  const phase = progress.phase;
  useEffect(() => {
    if (phase === "done") setAnnouncement(t("rx.live.done"));
    else if (phase === "refunded") setAnnouncement(t("rx.live.refunded"));
    else if (phase === "failed") setAnnouncement(t("rx.live.failed"));
  }, [phase]);

  const handleCorrection = useCallback(
    async (index: number, correction: PickedCorrection, candidates: readonly PickerCandidate[]) => {
      const base = result?.items[index];
      if (!base) return;
      const picked = candidates.find((candidate) => candidate.id === correction.candidateId);
      const pick: RxPick | null = picked
        ? { kind: "candidate", drugId: picked.id, name: picked.name }
        : correction.text
          ? { kind: "text", text: correction.text }
          : null;
      const after = picked?.id ?? correction.text;
      if (!pick || !after) return;

      // The row changes now; the API's answer replaces it, or the change is rolled back.
      setReviewIndex(null);
      setOverlay((current) => ({ ...current, [index]: optimisticDrugCorrection(base, pick) }));
      try {
        const saved = await api(`/rx/${view.id}/corrections`, {
          method: "POST",
          body: {
            itemIndex: index,
            field: "drug",
            after,
            consentForEval: correction.consentForEval,
          },
          schema: rxCorrectionResponseSchema,
        });
        setCorrected(saved.result);
        toast({ tone: "success", title: t("rx.correction.saved") });
      } catch (error) {
        const ref = extractErrorRef(error);
        toast({
          tone: "error",
          title: t("rx.correction.failed"),
          description: ref ? `${errorMessage(error)} (${ref})` : errorMessage(error),
        });
      } finally {
        setOverlay((current) =>
          Object.fromEntries(Object.entries(current).filter(([key]) => Number(key) !== index)),
        );
        // The "review" button may be gone (the line is now high confidence): keep focus in the row.
        container.current
          ?.querySelector<HTMLElement>(`[data-row-index="${String(index)}"] button`)
          ?.focus();
      }
    },
    [result, toast, view.id],
  );

  const reviewItem = reviewIndex === null ? undefined : items[reviewIndex];

  const ended = progress.phase !== "running";
  const showResult = progress.phase === "done" && result !== null;

  return (
    <div ref={container} className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <div className="flex flex-col gap-6 print:hidden">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="font-heading text-3xl font-bold text-primary sm:text-4xl">
              {t("rx.page.title")}
            </h1>
            {showResult ? (
              <p className="text-base text-text-muted">
                {result.date ? `${t("rx.result.date", { date: result.date })} · ` : ""}
                {t("rx.result.count", { count: items.length })}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/analyze/history" className={buttonStyles({ variant: "ghost" })}>
              <History aria-hidden className="size-4" />
              {t("rx.page.history")}
            </Link>
            <Link href="/analyze" className={buttonStyles({ variant: "secondary" })}>
              <Plus aria-hidden className="size-4" />
              {t("rx.page.new")}
            </Link>
          </div>
        </header>

        {!ended ? <RxProgressPanel progress={progress} elapsed={elapsed} /> : null}
        {progress.phase === "refunded" ? <RxRefunded /> : null}
        {progress.phase === "failed" ? (
          <RxFailed errorRef={progress.errorRef ?? view.errorRef} />
        ) : null}

        {progress.phase === "done" && result === null ? (
          loadError ? (
            <ErrorNotice error={loadError} onRetry={retryLoad} />
          ) : (
            <div aria-busy="true" className="flex flex-col gap-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          )
        ) : null}

        {showResult ? (
          <>
            {view.cached ? (
              <p className="text-sm text-text-muted">{t("rx.result.cached")}</p>
            ) : null}
            <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
              <section className="flex flex-col gap-3" aria-label={t("rx.viewer.label")}>
                <button
                  type="button"
                  aria-expanded={imageOpen}
                  aria-controls="rx-viewer-panel"
                  onClick={() => {
                    setImageOpen((open) => !open);
                  }}
                  className="inline-flex min-h-11 items-center justify-between gap-2 rounded-lg border border-neutral-400 bg-surface px-4 text-base font-semibold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus lg:hidden"
                >
                  {imageOpen ? t("rx.viewer.hide") : t("rx.viewer.show")}
                  {imageOpen ? (
                    <ChevronUp aria-hidden className="size-5" />
                  ) : (
                    <ChevronDown aria-hidden className="size-5" />
                  )}
                </button>
                <div id="rx-viewer-panel" className={imageOpen ? undefined : "max-lg:hidden"}>
                  <ImageViewer
                    pages={images.pages}
                    page={Math.min(pageIndex, Math.max(0, images.pages.length - 1))}
                    onPageChange={setPageIndex}
                    regions={regions}
                    activeId={activeIndex === null ? null : regionId(activeIndex)}
                    onHover={(id) => {
                      setHoverIndex(indexOfRegion(id));
                    }}
                    onSelect={(id) => {
                      setSelectedIndex(indexOfRegion(id));
                    }}
                    onImageError={images.reload}
                    onRetry={images.retry}
                  />
                </div>
              </section>

              <section className="flex min-w-0 flex-col gap-4">
                <h2 className="font-heading text-xl font-semibold text-text">
                  {t("rx.result.title")}
                </h2>
                {items.length === 0 ? (
                  <p className="text-base text-text-muted">{t("rx.result.empty")}</p>
                ) : (
                  <RxTable
                    items={items}
                    activeIndex={activeIndex}
                    selectedIndex={selectedIndex}
                    onActivate={setHoverIndex}
                    onSelect={setSelectedIndex}
                    onReview={setReviewIndex}
                    pending={pending}
                    modelOnly={modelOnly}
                  />
                )}
                <RxOverview result={result} />
                <RxNotices result={result} />
                <RxRating
                  key={view.id}
                  analysisId={view.id}
                  initial={{ rating: view.rating, shareForReview: view.shareForReview }}
                />
                <RxActions
                  analysis={view}
                  items={items}
                  result={result}
                  siteUrl={siteUrl}
                  reportDate={reportDate}
                  creditsPerPage={creditsPerPage}
                  balance={balance}
                />
              </section>
            </div>
          </>
        ) : null}

        <RxDisclaimer />
      </div>

      {showResult ? (
        <RxPrintSheet
          result={{ ...result, items }}
          branding={branding}
          siteUrl={siteUrl}
          reportDate={reportDate}
        />
      ) : null}

      <RxReview
        analysisId={view.id}
        index={reviewIndex}
        rawText={reviewItem?.rawText ?? ""}
        onClose={() => {
          setReviewIndex(null);
        }}
        onCorrect={(index, correction, candidates) => {
          void handleCorrection(index, correction, candidates);
        }}
      />
    </div>
  );
}
