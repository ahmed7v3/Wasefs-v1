"use client";

import { t } from "@wasfa/shared/i18n";
import { RX_RATING_NOTE_MAX, type RxRating } from "@wasfa/shared/rx";
import { rxRatingResponseSchema } from "@wasfa/shared/schemas/rx";
import { Button, Checkbox, Dialog, Field, Textarea, useToast } from "@wasfa/ui";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { extractErrorRef } from "../../lib/api-error";
import { errorMessage } from "../error-notice";

export interface RxRatingProps {
  analysisId: string;
  initial: { rating: RxRating | null; shareForReview: boolean };
}

/**
 * "Was the analysis good?" under the result. A rating is one tap; sharing the picture and the
 * reading with the team is a separate, explicit tick (unticked each time the dialog opens), with the
 * privacy sentence next to it. A person can change the rating, or withdraw the sharing, later.
 */
export function RxRating({ analysisId, initial }: RxRatingProps) {
  const { toast } = useToast();
  const [saved, setSaved] = useState(initial);
  const [choice, setChoice] = useState<RxRating | null>(null);
  const [note, setNote] = useState("");
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);

  const open = (rating: RxRating) => {
    setChoice(rating);
    setNote("");
    // Never pre-ticked: consent is asked again every time.
    setShare(false);
  };

  async function submit(): Promise<void> {
    if (choice === null) return;
    setBusy(true);
    try {
      const done = await api(`/rx/${analysisId}/rating`, {
        method: "POST",
        body: {
          rating: choice,
          note: note.trim() === "" ? undefined : note.trim(),
          shareForReview: share,
        },
        schema: rxRatingResponseSchema,
      });
      setSaved({ rating: done.rating, shareForReview: done.shareForReview });
      setChoice(null);
      toast({ tone: "success", title: t("rx.rating.thanks") });
    } catch (error) {
      const ref = extractErrorRef(error);
      toast({
        tone: "error",
        title: t("rx.rating.failed"),
        description: ref ? `${errorMessage(error)} (${ref})` : errorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-testid="rx-rating"
      aria-labelledby="rx-rating-title"
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 print:hidden"
    >
      <h2 id="rx-rating-title" className="font-heading text-lg font-semibold text-text">
        {saved.rating === null ? t("rx.rating.title") : t("rx.rating.saved")}
      </h2>
      {saved.rating !== null ? (
        <p className="text-base text-text-muted">
          {saved.rating === "good" ? t("rx.rating.good") : t("rx.rating.bad")}
          {saved.shareForReview ? ` · ${t("rx.rating.sharedYes")}` : ""}
        </p>
      ) : (
        <p className="text-base text-text-muted">{t("rx.rating.lead")}</p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          variant={saved.rating === "good" ? "primary" : "secondary"}
          aria-pressed={saved.rating === "good"}
          onClick={() => {
            open("good");
          }}
        >
          <ThumbsUp aria-hidden className="size-4" />
          {t("rx.rating.good")}
        </Button>
        <Button
          variant={saved.rating === "bad" ? "primary" : "secondary"}
          aria-pressed={saved.rating === "bad"}
          onClick={() => {
            open("bad");
          }}
        >
          <ThumbsDown aria-hidden className="size-4" />
          {t("rx.rating.bad")}
        </Button>
      </div>

      <Dialog
        open={choice !== null}
        onOpenChange={(next) => {
          if (!next) setChoice(null);
        }}
        title={choice === "good" ? t("rx.rating.dialogGood") : t("rx.rating.dialogBad")}
        description={t("rx.rating.dialogHint")}
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setChoice(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              name="send-rating"
              loading={busy}
              onClick={() => {
                void submit();
              }}
            >
              {t("rx.rating.send")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label={t("rx.rating.note")} hint={t("rx.rating.noteHint")}>
            {(control) => (
              <Textarea
                {...control}
                name="note"
                maxLength={RX_RATING_NOTE_MAX}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            )}
          </Field>
          <div className="flex flex-col gap-1 rounded-md border border-border bg-neutral-100 p-3">
            <Checkbox
              name="shareForReview"
              checked={share}
              onChange={(event) => {
                setShare(event.target.checked);
              }}
              label={
                <span className="flex flex-col">
                  <span>{t("rx.rating.share")}</span>
                  <span className="text-sm text-text-muted">{t("rx.rating.shareHint")}</span>
                </span>
              }
            />
          </div>
        </div>
      </Dialog>
    </section>
  );
}
