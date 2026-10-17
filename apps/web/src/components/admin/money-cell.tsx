import { moneyText, cn } from "@wasfa/ui";

export interface MoneyCellProps {
  amountMinor: number;
  currency: string;
  className?: string | undefined;
}

/** An amount in a table cell or a card: integer minor units formatted once, tabular figures. */
export function MoneyCell({ amountMinor, currency, className }: MoneyCellProps) {
  return <span className={cn("tabular-nums", className)}>{moneyText(amountMinor, currency)}</span>;
}

/** Per-currency amounts (`{ EGP: 1200, USD: 300 }`) as one line each; an empty map reads as zero. */
export function MoneyMap({
  values,
  fallbackCurrency = "EGP",
}: {
  values: Readonly<Record<string, number>>;
  fallbackCurrency?: string;
}) {
  const entries = Object.entries(values);
  if (entries.length === 0) return <MoneyCell amountMinor={0} currency={fallbackCurrency} />;
  return (
    <span className="flex flex-col">
      {entries.map(([currency, amountMinor]) => (
        <MoneyCell key={currency} amountMinor={amountMinor} currency={currency} />
      ))}
    </span>
  );
}
