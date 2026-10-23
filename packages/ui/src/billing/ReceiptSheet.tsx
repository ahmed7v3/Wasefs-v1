import { t } from "@wasfa/shared/i18n/public";

import { cn } from "../cn";

import { moneyText } from "./format";

export interface ReceiptParty {
  /** Label of the block: "البائع", "العميل". */
  heading: string;
  /** Ready lines (name, address, tax id, masked contact); empty ones are left out by the caller. */
  lines: readonly string[];
}

export interface ReceiptLine {
  key: string;
  label: string;
  /** Signed: a discount is negative. */
  amountMinor: number;
}

export interface ReceiptTotal {
  key: string;
  label: string;
  amountMinor: number;
  strong?: boolean | undefined;
}

export interface ReceiptSheetProps {
  currency: string;
  title: string;
  number: string;
  /** Ready sentences for the head: issued date, paid date, status, payment method. */
  meta: readonly { key: string; label: string; value: string }[];
  parties: readonly ReceiptParty[];
  /** What was bought. */
  itemLabel: string;
  lines: readonly ReceiptLine[];
  totals: readonly ReceiptTotal[];
  /** One grey note at the end (tax included, refunds). */
  notes?: readonly string[] | undefined;
  className?: string | undefined;
}

/**
 * A receipt with the full itemisation (BILLING §6.4). Plain black on white in print: the
 * `print:` variants drop the card chrome so the page that wraps it prints on its own.
 */
export function ReceiptSheet({
  currency,
  title,
  number,
  meta,
  parties,
  itemLabel,
  lines,
  totals,
  notes,
  className,
}: ReceiptSheetProps) {
  return (
    <article
      aria-label={title}
      className={cn(
        "mx-auto flex w-full max-w-2xl flex-col gap-6 rounded-xl border border-border bg-surface p-5 text-text shadow-card sm:p-8",
        "print:max-w-none print:gap-4 print:rounded-none print:border-0 print:p-0 print:shadow-none",
        className,
      )}
    >
      <header className="flex flex-col gap-1 border-b border-border pb-4">
        <h1 className="font-heading text-2xl font-bold text-primary print:text-black">{title}</h1>
        <p className="text-base text-text-muted">
          {t("billing.receipt.number")}: <bdi className="font-semibold tabular-nums">{number}</bdi>
        </p>
      </header>

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {meta.map((entry) => (
          <div key={entry.key} className="flex flex-col">
            <dt className="text-sm text-text-muted">{entry.label}</dt>
            <dd className="text-base font-semibold">{entry.value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-4 sm:grid-cols-2">
        {parties.map((party) => (
          <section key={party.heading} className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-text-muted">{party.heading}</h2>
            {party.lines.map((line) => (
              <p key={line} className="text-base">
                {line}
              </p>
            ))}
          </section>
        ))}
      </div>

      <section className="flex flex-col gap-3" aria-label={itemLabel}>
        <h2 className="font-heading text-lg font-bold">{itemLabel}</h2>
        <ul className="flex flex-col gap-2 border-y border-border py-3">
          {lines.map((line) => (
            <li key={line.key} className="flex items-baseline justify-between gap-3 text-base">
              <span>{line.label}</span>
              <span className="tabular-nums">
                <bdi>{moneyText(line.amountMinor, currency)}</bdi>
              </span>
            </li>
          ))}
        </ul>
        <dl className="flex flex-col gap-1.5">
          {totals.map((total) => (
            <div
              key={total.key}
              className={cn(
                "flex items-baseline justify-between gap-3",
                total.strong ? "font-heading text-xl font-bold" : "text-base",
              )}
            >
              <dt>{total.label}</dt>
              <dd className="tabular-nums">
                <bdi>{moneyText(total.amountMinor, currency)}</bdi>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {notes && notes.length > 0 ? (
        <footer className="flex flex-col gap-1 text-sm text-text-muted">
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </footer>
      ) : null}
    </article>
  );
}
