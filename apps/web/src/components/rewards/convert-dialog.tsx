"use client";

import { t } from "@wasfa/shared/i18n";
import {
  convertPreviewSchema,
  convertResultSchema,
  type MeRewards,
} from "@wasfa/shared/schemas/rewards";
import { Button, Dialog, Field, Input, useToast } from "@wasfa/ui";
import { useEffect, useRef, useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { formatPercent } from "../../lib/rewards-text";
import { ErrorNotice } from "../error-notice";

import type { z } from "zod";

export interface ConvertDialogProps {
  open: boolean;
  /** Points that can be converted: credit-only first, then cash. */
  available: number;
  conversion: MeRewards["conversion"];
  onClose: () => void;
  onConverted: () => void;
}

type Preview = z.output<typeof convertPreviewSchema>;
type PreviewState = { points: number; result: Preview } | { points: number; error: unknown };

const PREVIEW_DELAY_MS = 300;

/** The typed amount as whole points, or `null` while it is empty or not a positive integer. */
function parsePoints(text: string): number | null {
  return /^[1-9]\d{0,8}$/.test(text.trim()) ? Number(text.trim()) : null;
}

function ConvertForm({
  available,
  conversion,
  onClose,
  onConverted,
}: Omit<ConvertDialogProps, "open">) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  // One id per amount: a retried tap converts once, a different amount is a different request.
  const request = useRef<{ points: number; id: string } | null>(null);
  const points = parsePoints(text);

  useEffect(() => {
    if (points === null) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api(`/me/rewards/convert/preview?points=${String(points)}`, {
        schema: convertPreviewSchema,
        signal: controller.signal,
      }).then(
        (result) => {
          setPreview({ points, result });
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setPreview({ points, error });
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [points]);

  // The preview of an older amount is not an answer for this one.
  const current = points !== null && preview?.points === points ? preview : null;
  const result = current && "result" in current ? current.result : null;
  const previewError = current && "error" in current ? current.error : null;
  const loading = points !== null && current === null;
  const bonus = conversion.bonusBps > 0 ? formatPercent(conversion.bonusBps) : null;

  const confirm = async () => {
    if (points === null || !result?.possible) return;
    if (request.current?.points !== points) {
      request.current = { points, id: crypto.randomUUID() };
    }
    setSubmitting(true);
    setFailure(null);
    try {
      const done = await api("/me/rewards/convert", {
        method: "POST",
        body: { points, requestId: request.current.id },
        schema: convertResultSchema,
      });
      toast({
        tone: "success",
        title: t("rewardsPage.convert.done", { credits: formatNumber(done.credits) }),
      });
      onConverted();
      onClose();
    } catch (error) {
      setFailure(error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void confirm();
      }}
    >
      <Field
        label={t("rewardsPage.convert.field")}
        hint={t("rewardsPage.convert.available", { count: formatNumber(available) })}
        error={text.trim() !== "" && points === null ? t("rewardsPage.convert.invalid") : undefined}
      >
        {(control) => (
          <Input
            {...control}
            name="points"
            inputMode="numeric"
            ltr
            autoComplete="off"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setFailure(null);
            }}
          />
        )}
      </Field>
      <Button
        type="button"
        variant="ghost"
        className="self-start"
        disabled={available < 1}
        onClick={() => {
          setText(String(available));
        }}
      >
        {t("rewardsPage.convert.all")}
      </Button>

      <div role="status" aria-live="polite" className="min-h-16 rounded-md bg-primary-soft p-4">
        {loading ? (
          <p className="text-base text-text-muted">{t("rewardsPage.convert.calculating")}</p>
        ) : result ? (
          result.possible ? (
            <div className="flex flex-col gap-1">
              <p
                className="font-heading text-2xl font-bold text-primary"
                data-testid="preview-credits"
              >
                {t("rewardsPage.convert.youGet", { credits: formatNumber(result.credits) })}
              </p>
              {bonus ? (
                <p className="text-sm text-text-muted">
                  {t("rewardsPage.convert.bonus", { percent: bonus })}
                </p>
              ) : null}
              <p className="text-sm text-text-muted">
                {t("rewardsPage.convert.from", {
                  creditOnly: formatNumber(result.fromCreditOnly),
                  cash: formatNumber(result.fromCash),
                })}
              </p>
            </div>
          ) : (
            <p className="text-base text-text">
              {t(`rewardsPage.reason.${result.reason ?? "insufficient_points"}`)}
            </p>
          )
        ) : previewError ? (
          <p className="text-base text-text">{t("rewardsPage.convert.previewFailed")}</p>
        ) : (
          <p className="text-base text-text-muted">
            {t("rewardsPage.convert.rate", { rate: formatNumber(conversion.pointsPerCredit) })}
          </p>
        )}
      </div>

      {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          name="confirm-convert"
          loading={submitting}
          disabled={!result?.possible}
        >
          {t("rewardsPage.convert.confirm")}
        </Button>
      </div>
    </form>
  );
}

/**
 * «تحويل إلى رصيد»: the person types points and sees exactly what the server will add (its preview),
 * then confirms. The client never computes credits; it only formats what the API answered.
 */
export function ConvertDialog({ open, ...rest }: ConvertDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) rest.onClose();
      }}
      title={t("rewardsPage.convert.title")}
      description={t("rewardsPage.convert.lead")}
    >
      {/* Mounted only while open: every visit starts empty with a fresh request id. */}
      {open ? <ConvertForm {...rest} /> : null}
    </Dialog>
  );
}
