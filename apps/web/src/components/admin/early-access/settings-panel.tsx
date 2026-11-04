"use client";

import { fromMinor, toMinor } from "@wasfa/shared/money";
import { adminSettingSchema, adminSettingsResponseSchema } from "@wasfa/shared/schemas/admin";
import {
  EARLY_PRICE_CURRENCIES,
  earlyAccessSettingsSchema,
  type EarlyAccessSettings,
  type EarlyPriceCurrency,
} from "@wasfa/shared/schemas/early-access";
import { Button, Card, CardTitle, Checkbox, Field, Input, Skeleton, useToast } from "@wasfa/ui";
import { Plus, X } from "lucide-react";
import { useState } from "react";

import { api } from "../../../lib/api-client";
import { useReauth } from "../../../lib/reauth";
import { useResource } from "../../../lib/use-admin-data";
import { ErrorNotice } from "../../error-notice";

import { T } from "./labels";

const SETTING_KEY = "earlyAccess";
const MIN_PRICES = 2;
const MAX_PRICES = 8;

type Ladders = Record<EarlyPriceCurrency, string[]>;

const toDecimals = (settings: EarlyAccessSettings): Ladders => ({
  EGP: settings.priceLadders.EGP.map((minor) => fromMinor(minor, "EGP")),
  SAR: settings.priceLadders.SAR.map((minor) => fromMinor(minor, "SAR")),
  AED: settings.priceLadders.AED.map((minor) => fromMinor(minor, "AED")),
  USD: settings.priceLadders.USD.map((minor) => fromMinor(minor, "USD")),
});

/** Decimal inputs to the validated settings value; `null` when any price or count is invalid. */
export function buildSettings(
  ladders: Ladders,
  abHeadlines: boolean,
  counterMin: string,
  allowFreeOption: boolean,
): EarlyAccessSettings | null {
  try {
    const priceLadders = Object.fromEntries(
      EARLY_PRICE_CURRENCIES.map((currency) => [
        currency,
        ladders[currency].map((amount) => toMinor(amount, currency)),
      ]),
    );
    const parsed = earlyAccessSettingsSchema.safeParse({
      priceLadders,
      abHeadlines,
      counterMinToShow: Number(counterMin),
      allowFreeOption,
    });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function SettingsForm({ initial }: { initial: EarlyAccessSettings }) {
  const { toast } = useToast();
  const reauth = useReauth();
  const [ladders, setLadders] = useState<Ladders>(() => toDecimals(initial));
  const [abHeadlines, setAbHeadlines] = useState(initial.abHeadlines);
  const [allowFreeOption, setAllowFreeOption] = useState(initial.allowFreeOption);
  const [counterMin, setCounterMin] = useState(String(initial.counterMinToShow));
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const setPrice = (currency: EarlyPriceCurrency, index: number, value: string) => {
    setLadders((current) => ({
      ...current,
      [currency]: current[currency].map((price, i) => (i === index ? value : price)),
    }));
  };

  const save = async () => {
    const value = buildSettings(ladders, abHeadlines, counterMin, allowFreeOption);
    if (!value) {
      setError(true);
      return;
    }
    setError(false);
    setBusy(true);
    try {
      await reauth.run(() =>
        api(`/admin/settings/${SETTING_KEY}`, {
          method: "PUT",
          body: { value },
          schema: adminSettingSchema,
        }),
      );
      toast({ tone: "success", title: T.settings.saved });
    } catch {
      toast({ tone: "error", title: T.settings.failed });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card elevation="flat" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <CardTitle>{T.settings.title}</CardTitle>
        <p className="text-sm text-text-muted">{T.settings.lead}</p>
      </div>

      <section className="flex flex-col gap-4">
        <div>
          <h3 className="font-heading text-lg font-semibold">{T.settings.ladders}</h3>
          <p className="text-sm text-text-muted">{T.settings.laddersHint}</p>
        </div>
        {EARLY_PRICE_CURRENCIES.map((currency) => (
          <fieldset key={currency} className="flex flex-col gap-2">
            <legend className="mb-1 font-semibold text-text">{currency}</legend>
            <div className="flex flex-wrap items-end gap-2">
              {ladders[currency].map((price, index) => (
                <div key={index} className="flex items-end gap-1">
                  <Field label={`${currency} ${String(index + 1)}`} className="w-28">
                    {(control) => (
                      <Input
                        {...control}
                        ltr
                        inputMode="decimal"
                        value={price}
                        onChange={(event) => {
                          setPrice(currency, index, event.target.value);
                        }}
                      />
                    )}
                  </Field>
                  <Button
                    variant="ghost"
                    aria-label={T.settings.removePrice}
                    disabled={ladders[currency].length <= MIN_PRICES}
                    onClick={() => {
                      setLadders((current) => ({
                        ...current,
                        [currency]: current[currency].filter((_, i) => i !== index),
                      }));
                    }}
                  >
                    <X aria-hidden className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                disabled={ladders[currency].length >= MAX_PRICES}
                onClick={() => {
                  setLadders((current) => ({ ...current, [currency]: [...current[currency], ""] }));
                }}
              >
                <Plus aria-hidden className="size-4" />
                {T.settings.addPrice}
              </Button>
            </div>
          </fieldset>
        ))}
      </section>

      <section className="flex flex-col gap-1">
        <Checkbox
          label={T.settings.abHeadlines}
          checked={abHeadlines}
          onChange={(event) => {
            setAbHeadlines(event.target.checked);
          }}
        />
        <p className="text-sm text-text-muted">{T.settings.abHeadlinesHint}</p>
      </section>

      <section className="flex flex-col gap-1">
        <Checkbox
          label={T.settings.allowFreeOption}
          checked={allowFreeOption}
          onChange={(event) => {
            setAllowFreeOption(event.target.checked);
          }}
        />
        <p className="text-sm text-text-muted">{T.settings.allowFreeOptionHint}</p>
      </section>

      <Field label={T.settings.counterMin} hint={T.settings.counterMinHint} className="max-w-xs">
        {(control) => (
          <Input
            {...control}
            ltr
            inputMode="numeric"
            value={counterMin}
            onChange={(event) => {
              setCounterMin(event.target.value);
            }}
          />
        )}
      </Field>

      {error ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {T.settings.invalid}
        </p>
      ) : null}
      <div>
        <Button disabled={busy} onClick={() => void save()}>
          {T.settings.save}
        </Button>
      </div>
    </Card>
  );
}

/** The `earlyAccess` site setting: landing-page price ladders, A/B headlines and the public counter. */
export function SettingsPanel() {
  const resource = useResource("/admin/settings", adminSettingsResponseSchema);
  if (resource.status === "loading") {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <p className="sr-only" role="status">
          {T.loading}
        </p>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (resource.status === "error") {
    return <ErrorNotice error={resource.error} onRetry={resource.reload} />;
  }
  const item = resource.data.items.find((entry) => entry.key === SETTING_KEY);
  // No row yet (or a value from before a field existed): the schema defaults fill the form.
  const stored = earlyAccessSettingsSchema.safeParse(
    item && typeof item.value === "object" && item.value !== null ? item.value : {},
  );
  const initial = stored.success ? stored.data : earlyAccessSettingsSchema.parse({});
  return <SettingsForm initial={initial} />;
}
