"use client";

import { t } from "@wasfa/shared/i18n";
import {
  rxCreateResponseSchema,
  type RxResult,
  type RxResultItem,
  type RxView,
} from "@wasfa/shared/schemas/rx";
import { Button, buttonStyles, useToast } from "@wasfa/ui";
import { Copy, Printer, Share2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { extractErrorRef } from "../../lib/api-error";
import { buildCopyText, buildShareText, whatsappShareUrl, type RxReport } from "../../lib/rx-text";
import { withWorkspace } from "../../lib/workspace";
import { errorMessage } from "../error-notice";

export interface RxActionsProps {
  analysis: Pick<RxView, "id" | "mode" | "files">;
  items: readonly RxResultItem[];
  /** The rest of the result the shared text needs (overview, prescription date, matching mode). */
  result: Pick<RxResult, "overview" | "date" | "matching">;
  /** The site address that ends every shared text. */
  siteUrl: string;
  /** Today's date, formatted. */
  reportDate: string;
  /** Credits per page (public `rx` setting); the deep re-run costs this per page. */
  creditsPerPage: number;
  /** The wallet balance, when known. */
  balance: number | null;
}

/** "Offer a better look" only where it can help: some line is low confidence, and the pictures still exist. */
export function canRunDeep(
  analysis: Pick<RxView, "mode" | "files">,
  items: readonly Pick<RxResultItem, "badge">[],
): boolean {
  return (
    analysis.mode !== "deep" &&
    analysis.files.length > 0 &&
    analysis.files.every((file) => !file.imageDeleted) &&
    items.some((item) => item.badge === "low")
  );
}

/**
 * Copy, print, share and the deep re-run. Share is a plain link to `wa.me/?text=` carrying only the
 * text built by `buildShareText` (no image, no names). The deep re-run posts the same files with
 * `mode: "deep"` and opens the new analysis; its price is shown first and a short balance disables it.
 */
export function RxActions({
  analysis,
  items,
  result,
  siteUrl,
  reportDate,
  creditsPerPage,
  balance,
}: RxActionsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [deepBusy, setDeepBusy] = useState(false);

  const price = analysis.files.length * creditsPerPage;
  const short = balance !== null && balance < price;
  const deep = canRunDeep(analysis, items);

  const report: RxReport = {
    items,
    overview: result.overview,
    date: result.date,
    matching: result.matching,
  };
  const textOptions = { siteUrl, reportDate };
  const canShareSheet = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function shareSheet(): Promise<void> {
    try {
      await navigator.share({
        title: t("rx.share.title"),
        text: buildShareText(report, textOptions),
        url: siteUrl,
      });
    } catch (error) {
      // Closing the sheet is not a failure.
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast({ tone: "error", title: t("rx.action.shareFailed") });
    }
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(buildCopyText(report, textOptions));
      toast({ tone: "success", title: t("rx.action.copied") });
    } catch {
      toast({ tone: "error", title: t("rx.action.copyFailed") });
    }
  }

  async function runDeep(): Promise<void> {
    setDeepBusy(true);
    try {
      const created = await api("/rx", {
        method: "POST",
        body: withWorkspace({ fileIds: analysis.files.map((file) => file.fileId), mode: "deep" }),
        schema: rxCreateResponseSchema,
      });
      router.push(`/analyze/${created.id}`);
    } catch (error) {
      const ref = extractErrorRef(error);
      toast({
        tone: "error",
        title: t("rx.action.deepFailed"),
        description: ref ? `${errorMessage(error)} (${ref})` : errorMessage(error),
      });
      setDeepBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 print:hidden">
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          onClick={() => {
            void copy();
          }}
        >
          <Copy aria-hidden className="size-4" />
          {t("rx.action.copy")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            window.print();
          }}
        >
          <Printer aria-hidden className="size-4" />
          {t("rx.action.print")}
        </Button>
        {canShareSheet ? (
          <Button
            variant="secondary"
            onClick={() => {
              void shareSheet();
            }}
          >
            <Share2 aria-hidden className="size-4" />
            {t("rx.action.shareSheet")}
          </Button>
        ) : null}
        <a
          href={whatsappShareUrl(buildShareText(report, textOptions))}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonStyles({ variant: "secondary" })}
        >
          <Share2 aria-hidden className="size-4" />
          {t("rx.action.share")}
        </a>
      </div>
      {deep ? (
        <div
          data-testid="rx-deep"
          className="flex flex-col items-start gap-2 rounded-md border border-border bg-neutral-100 p-4"
        >
          <p className="text-base text-text-muted">{t("rx.action.deepHint")}</p>
          <p className="text-base font-semibold tabular-nums text-text">
            {t("rx.action.deepPrice", { price })}
          </p>
          {short ? (
            <p role="alert" className="text-base text-danger">
              {t("rx.action.deepShort", { balance, price })}
            </p>
          ) : null}
          <Button
            variant="primary"
            loading={deepBusy}
            disabled={short}
            onClick={() => {
              void runDeep();
            }}
          >
            <Sparkles aria-hidden className="size-4" />
            {t("rx.action.deep")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
