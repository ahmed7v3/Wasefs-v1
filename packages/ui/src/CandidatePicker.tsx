"use client";

import { t } from "@wasfa/shared/i18n";
import { useId, useState } from "react";

import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { cn } from "./cn";
import { Dialog } from "./dialog";
import { Field } from "./field";
import { Input } from "./input";
import { Spinner } from "./spinner";

export interface PickerCandidate {
  id: string;
  /** The brand, as written on the box. */
  name: string;
  /** The other-language brand, if any. */
  alternateName?: string | null | undefined;
  strength?: string | null | undefined;
  form?: string | null | undefined;
  /** Active ingredient(s), when the source gives them. */
  ingredient?: string | null | undefined;
  manufacturer?: string | null | undefined;
  withdrawn?: boolean | undefined;
}

export interface PickedCorrection {
  /** The text typed by the person; absent when a candidate was picked. */
  text?: string | undefined;
  candidateId?: string | undefined;
  /** Opt-in (unchecked by default) to use this correction in the evaluation set. */
  consentForEval: boolean;
}

export interface CandidatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The text read from the image: always shown, the person decides against it. */
  rawText: string;
  /** `null` while the candidates are being fetched. */
  candidates: readonly PickerCandidate[] | null;
  loadFailed?: boolean | undefined;
  onRetry?: (() => void) | undefined;
  /** A correction is being saved: every control waits. */
  busy?: boolean | undefined;
  /** Why the last attempt failed (shown inline; the dialog stays open). */
  error?: string | null | undefined;
  /** One tap on a candidate, or the typed text, saves the correction. */
  onCorrect: (correction: PickedCorrection) => void;
}

/**
 * The review dialog of one prescription line. It shows the raw text read, the closest drugs with
 * strength and form, "none of these" with a free-text field, and a consent checkbox for the
 * evaluation set (unchecked by default). A tap on a candidate is the whole correction.
 */
export function CandidatePicker({
  open,
  onOpenChange,
  rawText,
  candidates,
  loadFailed,
  onRetry,
  busy,
  error,
  onCorrect,
}: CandidatePickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("rx.picker.title")}>
      {/* Mounted only while open, so each opening starts with the consent box unchecked. */}
      {open ? (
        <PickerBody
          rawText={rawText}
          candidates={candidates}
          loadFailed={loadFailed ?? false}
          onRetry={onRetry}
          busy={busy ?? false}
          error={error ?? null}
          onCorrect={onCorrect}
        />
      ) : null}
    </Dialog>
  );
}

interface PickerBodyProps {
  rawText: string;
  candidates: readonly PickerCandidate[] | null;
  loadFailed: boolean;
  onRetry: (() => void) | undefined;
  busy: boolean;
  error: string | null;
  onCorrect: (correction: PickedCorrection) => void;
}

function PickerBody({
  rawText,
  candidates,
  loadFailed,
  onRetry,
  busy,
  error,
  onCorrect,
}: PickerBodyProps) {
  const [consent, setConsent] = useState(false);
  const [other, setOther] = useState(false);
  const [text, setText] = useState("");
  const listId = useId();
  const typed = text.trim();

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-text-muted">{t("rx.picker.raw")}</h3>
        <p
          data-testid="picker-raw"
          className="rounded-md bg-neutral-100 px-3 py-2 text-lg font-semibold text-text"
        >
          <bdi>{rawText}</bdi>
        </p>
      </section>

      <section aria-labelledby={`${listId}-title`} className="flex flex-col gap-3">
        <h3 id={`${listId}-title`} className="text-base font-semibold text-text">
          {t("rx.picker.candidates")}
        </h3>
        {candidates === null && !loadFailed ? (
          <p className="flex items-center gap-2 text-base text-text-muted" role="status">
            <Spinner decorative />
            {t("rx.picker.loading")}
          </p>
        ) : null}
        {loadFailed ? (
          <div role="alert" className="flex flex-col items-start gap-2 text-base text-danger">
            <p>{t("rx.picker.failed")}</p>
            {onRetry ? (
              <Button variant="secondary" onClick={onRetry}>
                {t("common.retry")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {candidates !== null && candidates.length === 0 ? (
          <p className="text-base text-text-muted">{t("rx.picker.empty")}</p>
        ) : null}
        {candidates !== null && candidates.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onCorrect({ candidateId: candidate.id, consentForEval: consent });
                  }}
                  className={cn(
                    "flex min-h-11 w-full flex-col items-start gap-0.5 rounded-lg border border-neutral-400 bg-surface px-4 py-3 text-start",
                    "transition-colors duration-150 hover:border-primary hover:bg-primary-soft",
                    "focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-50",
                  )}
                >
                  <span className="text-base font-semibold text-text">
                    <bdi>{candidate.name}</bdi>
                    {candidate.alternateName ? (
                      <span className="ms-2 font-normal text-text-muted">
                        <bdi>{candidate.alternateName}</bdi>
                      </span>
                    ) : null}
                  </span>
                  <CandidateDetails candidate={candidate} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <Checkbox
        name="consentForEval"
        checked={consent}
        disabled={busy}
        onChange={(event) => {
          setConsent(event.currentTarget.checked);
        }}
        label={
          <span className="flex flex-col">
            <span>{t("rx.picker.consent")}</span>
            <span className="text-sm text-text-muted">{t("rx.picker.consentHint")}</span>
          </span>
        }
      />

      <section className="flex flex-col gap-3">
        <Button
          variant="secondary"
          aria-expanded={other}
          aria-controls={`${listId}-other`}
          disabled={busy}
          onClick={() => {
            setOther((value) => !value);
          }}
        >
          {t("rx.picker.none")}
        </Button>
        <form
          id={`${listId}-other`}
          hidden={!other}
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (typed !== "" && !busy) onCorrect({ text: typed, consentForEval: consent });
          }}
        >
          <Field label={t("rx.picker.freeText")}>
            {(control) => (
              <Input
                {...control}
                value={text}
                maxLength={200}
                disabled={busy}
                autoComplete="off"
                onChange={(event) => {
                  setText(event.currentTarget.value);
                }}
              />
            )}
          </Field>
          <Button type="submit" loading={busy} disabled={typed === ""}>
            {t("rx.picker.save")}
          </Button>
        </form>
      </section>

      {error ? (
        <p role="alert" className="text-base text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CandidateDetails({ candidate }: { candidate: PickerCandidate }) {
  const parts = [
    candidate.ingredient ? t("rx.picker.ingredient", { value: candidate.ingredient }) : null,
    candidate.strength ? t("rx.picker.strength", { value: candidate.strength }) : null,
    candidate.form ?? null,
    candidate.manufacturer ?? null,
  ].filter((part): part is string => part !== null && part !== "");
  if (parts.length === 0 && !candidate.withdrawn) return null;
  return (
    <span className="text-sm text-text-muted">
      <bdi>{parts.join(" · ")}</bdi>
      {candidate.withdrawn ? (
        <span className="ms-2 font-semibold text-warning">{t("rx.picker.withdrawn")}</span>
      ) : null}
    </span>
  );
}
