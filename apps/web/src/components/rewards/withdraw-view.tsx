"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import {
  payoutDestinationsSchema,
  withdrawalCreatedSchema,
  withdrawalEligibilitySchema,
  withdrawalListSchema,
  type PayoutDestinationView,
  type WithdrawalEligibility,
  type WithdrawalView as Withdrawal,
} from "@wasfa/shared/schemas/withdrawals";
import { Button, Card, Dialog, Field, Input, Select, Skeleton, moneyText, useToast } from "@wasfa/ui";
import { Banknote, Plus, Trash2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { errorReason } from "../../lib/api-error";
import { formatDate, formatDateTime } from "../../lib/dates";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import type { z } from "zod";

type Destinations = z.output<typeof payoutDestinationsSchema>;
type Method = Destinations["methods"][number];

const reasonText = (reason: string) =>
  t(`rewards.withdrawal.refusal.${reason}` as MessageKey);

/** Whole points, or `null` while the text is not a positive integer. */
function parsePoints(text: string): number | null {
  return /^[1-9]\d{0,8}$/.test(text.trim()) ? Number(text.trim()) : null;
}

function EligibilityCard({ eligibility }: { eligibility: WithdrawalEligibility }) {
  const ageMissing = Math.max(0, eligibility.minAccountAgeDays - eligibility.accountAgeDays);
  return (
    <Card elevation="card" className="flex flex-col gap-4">
      <h2 className="font-heading text-xl font-bold text-text">
        {t("withdrawPage.eligibility.title")}
      </h2>
      <p className="text-base text-text" data-testid="withdraw-cash">
        {t("withdrawPage.eligibility.cash", {
          points: formatNumber(eligibility.cash),
          amount: moneyText(eligibility.cashValueMinor, eligibility.currency),
        })}
      </p>
      <p className="text-sm text-text-muted">
        {t("withdrawPage.eligibility.minimum", {
          points: formatNumber(eligibility.minWithdrawalPoints),
          amount: moneyText(eligibility.minWithdrawalMinor, eligibility.currency),
        })}
      </p>
      {eligibility.pointsToMinimum > 0 ? (
        <progress
          value={Math.min(eligibility.cash, eligibility.minWithdrawalPoints)}
          max={eligibility.minWithdrawalPoints}
          aria-label={t("withdrawPage.eligibility.progress")}
          className="h-2 w-full max-w-md overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-neutral-100 [&::-webkit-progress-value]:bg-primary"
        />
      ) : null}
      {eligibility.eligible ? (
        <Notice tone="success">{t("withdrawPage.eligibility.ready")}</Notice>
      ) : (
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold text-text">
            {t("withdrawPage.eligibility.whyTitle")}
          </h3>
          <ul className="flex list-disc flex-col gap-1 ps-5 text-base text-text">
            {eligibility.reasons.map((reason) => (
              <li key={reason}>
                {reason === "account_too_new" && ageMissing > 0
                  ? t("withdrawPage.eligibility.age", { days: formatNumber(eligibility.minAccountAgeDays) })
                  : reasonText(reason)}
              </li>
            ))}
            {eligibility.usableDestinations === 0 && eligibility.nextDestinationUsableAt === null ? (
              <li>{t("withdrawPage.request.noDestination")}</li>
            ) : null}
          </ul>
        </div>
      )}
      <p className="text-sm text-text-muted">
        {t("withdrawPage.eligibility.monthly", {
          points: formatNumber(eligibility.monthly.remaining),
        })}
      </p>
    </Card>
  );
}

/** The fields a method asks for, validated by the server again (this is only the first line). */
const FIELD_PATTERNS: Record<string, RegExp> = {
  egypt_mobile: /^01[0125]\d{8}$/,
  iban: /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/,
};

function AddDestinationDialog({
  open,
  methods,
  onClose,
  onSaved,
}: {
  open: boolean;
  methods: Method[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [methodKey, setMethodKey] = useState(methods[0]?.key ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const method = methods.find((entry) => entry.key === methodKey);

  const invalid = (kind: string, value: string) => {
    const pattern = FIELD_PATTERNS[kind];
    return value.trim() !== "" && pattern !== undefined && !pattern.test(value.replace(/\s+/g, ""));
  };
  const complete =
    method !== undefined &&
    method.fields.every((field) => {
      const value = values[field.key] ?? "";
      return (!field.required || value.trim() !== "") && !invalid(field.kind, value);
    });

  const save = async () => {
    if (!method || !complete) return;
    setSaving(true);
    setFailure(null);
    try {
      await api("/me/payout-destinations", {
        method: "POST",
        body: {
          methodKey: method.key,
          values: Object.fromEntries(
            method.fields.map((field) => [field.key, (values[field.key] ?? "").replace(/\s+/g, "")]),
          ),
        },
      });
      toast({ tone: "success", title: t("withdrawPage.destinations.saved") });
      onSaved();
      onClose();
    } catch (error) {
      setFailure(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("withdrawPage.destinations.dialogTitle")}
      description={t("withdrawPage.destinations.lead")}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label={t("withdrawPage.destinations.method")}>
          {(control) => (
            <Select
              {...control}
              name="method"
              value={methodKey}
              onChange={(event) => {
                setMethodKey(event.target.value);
                setValues({});
                setFailure(null);
              }}
            >
              {methods.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.nameAr}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {method?.fields.map((field) => {
          const value = values[field.key] ?? "";
          return (
            <Field
              key={field.key}
              label={t(field.labelKey as MessageKey)}
              hint={
                field.kind === "text"
                  ? undefined
                  : t(`withdrawPage.field.${field.kind}.hint` as MessageKey)
              }
              error={invalid(field.kind, value) ? t("withdrawPage.field.invalid") : undefined}
            >
              {(control) => (
                <Input
                  {...control}
                  name={`field-${field.key}`}
                  ltr
                  autoComplete="off"
                  inputMode={field.kind === "egypt_mobile" ? "numeric" : undefined}
                  value={value}
                  onChange={(event) => {
                    setValues((current) => ({ ...current, [field.key]: event.target.value }));
                    setFailure(null);
                  }}
                />
              )}
            </Field>
          );
        })}
        {failure ? (
          errorReason(failure) === "destination_in_use" ? (
            <Notice tone="warning">{t("withdrawPage.destinations.inUse")}</Notice>
          ) : (
            <ErrorNotice error={failure} supportHref={null} />
          )
        ) : null}
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" name="save-destination" loading={saving} disabled={!complete}>
            {t("withdrawPage.destinations.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DestinationsCard({
  data,
  onChanged,
}: {
  data: Destinations;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const remove = async (destination: PayoutDestinationView) => {
    setFailure(null);
    try {
      await api(`/me/payout-destinations/${destination.id}`, { method: "DELETE" });
      toast({ tone: "success", title: t("withdrawPage.destinations.removed") });
      onChanged();
    } catch (error) {
      setFailure(error);
    }
  };
  const full = data.destinations.length >= data.max;
  return (
    <Card elevation="card" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-xl font-bold text-text">
            {t("withdrawPage.destinations.title")}
          </h2>
          <p className="max-w-prose text-sm text-text-muted">
            {t("withdrawPage.destinations.lead")}
          </p>
        </div>
        <Button
          variant="secondary"
          name="add-destination"
          disabled={full || data.methods.length === 0}
          onClick={() => {
            setAdding(true);
          }}
        >
          <Plus aria-hidden className="size-4" />
          {t("withdrawPage.destinations.add")}
        </Button>
      </div>
      {data.methods.length === 0 ? (
        <Notice tone="info">{t("withdrawPage.destinations.noMethods")}</Notice>
      ) : null}
      {data.destinations.length === 0 ? (
        <p className="text-base text-text-muted">{t("withdrawPage.destinations.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60" data-testid="destinations">
          {data.destinations.map((destination) => (
            <li key={destination.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="flex flex-col">
                <span className="font-semibold text-text">{destination.methodNameAr}</span>
                <bdi dir="ltr" className="text-sm text-text-muted">
                  {destination.masked}
                </bdi>
              </span>
              <span className="flex items-center gap-3">
                <span className={destination.usable ? "text-sm text-success" : "text-sm text-text-muted"}>
                  {destination.usable
                    ? t("withdrawPage.destinations.usable")
                    : t("withdrawPage.destinations.waiting", {
                        date: formatDateTime(destination.usableAfter),
                      })}
                </span>
                <Button
                  variant="ghost"
                  aria-label={t("withdrawPage.destinations.removeLabel", {
                    destination: destination.masked,
                  })}
                  onClick={() => {
                    void remove(destination);
                  }}
                >
                  <Trash2 aria-hidden className="size-4" />
                  {t("withdrawPage.destinations.remove")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {full ? (
        <p className="text-sm text-text-muted">
          {t("withdrawPage.destinations.max", { max: formatNumber(data.max) })}
        </p>
      ) : null}
      {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
      {adding ? (
        <AddDestinationDialog
          open
          methods={data.methods}
          onClose={() => {
            setAdding(false);
          }}
          onSaved={onChanged}
        />
      ) : null}
    </Card>
  );
}

function RequestCard({
  eligibility,
  destinations,
  onRequested,
}: {
  eligibility: WithdrawalEligibility;
  destinations: PayoutDestinationView[];
  onRequested: () => void;
}) {
  const { toast } = useToast();
  const reauth = useReauth();
  const usable = destinations.filter((destination) => destination.usable);
  const [text, setText] = useState("");
  const [chosenId, setDestinationId] = useState(usable[0]?.id ?? "");
  // The list changes after mount (a first destination saved or its cooldown ending, a removal), so a
  // choice that is no longer usable falls back to the first usable one, as the select shows it.
  const destinationId = usable.some((entry) => entry.id === chosenId) ? chosenId : (usable[0]?.id ?? "");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  // One id per (amount, destination): a double tap or a retry after re-auth sends one request.
  const request = useRef<{ key: string; id: string } | null>(null);
  const points = parsePoints(text);
  const destination = usable.find((entry) => entry.id === destinationId);
  const ready = eligibility.eligible && points !== null && destination !== undefined;
  // Display only: the server snapshots the amount and the rate when it accepts the request.
  const amountMinor = points === null ? 0 : points * eligibility.pointValueMinor;

  const send = async () => {
    if (!ready) return;
    const key = `${String(points)}:${destination.id}`;
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    const requestId = request.current.id;
    setSending(true);
    setFailure(null);
    try {
      await reauth.run(() =>
        api("/me/withdrawals", {
          method: "POST",
          body: { points, destinationId: destination.id, requestId },
          schema: withdrawalCreatedSchema,
        }),
      );
      toast({ tone: "success", title: t("withdrawPage.request.done") });
      setConfirming(false);
      setText("");
      request.current = null;
      onRequested();
    } catch (error) {
      setFailure(error);
    } finally {
      setSending(false);
    }
  };

  return (
    <Card elevation="card" className="flex flex-col gap-4">
      <h2 className="font-heading text-xl font-bold text-text">{t("withdrawPage.request.title")}</h2>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) setConfirming(true);
        }}
      >
        <Field
          label={t("withdrawPage.request.points")}
          hint={t("withdrawPage.request.pointsHint", { points: formatNumber(eligibility.cash) })}
          error={text.trim() !== "" && points === null ? t("withdrawPage.request.invalid") : undefined}
        >
          {(control) => (
            <Input
              {...control}
              name="points"
              inputMode="numeric"
              ltr
              autoComplete="off"
              disabled={!eligibility.eligible}
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
          disabled={!eligibility.eligible}
          onClick={() => {
            setText(String(Math.min(eligibility.cash, eligibility.monthly.remaining)));
          }}
        >
          {t("withdrawPage.request.all")}
        </Button>
        {usable.length === 0 ? (
          <p className="text-base text-text-muted">{t("withdrawPage.request.noDestination")}</p>
        ) : (
          <Field label={t("withdrawPage.request.destination")}>
            {(control) => (
              <Select
                {...control}
                name="destination"
                value={destinationId}
                onChange={(event) => {
                  setDestinationId(event.target.value);
                }}
              >
                {usable.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {`${entry.methodNameAr} ${entry.masked}`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {failure && !confirming ? <ErrorNotice error={failure} supportHref={null} /> : null}
        <div>
          <Button type="submit" name="continue-withdraw" disabled={!ready}>
            <Banknote aria-hidden className="size-4" />
            {t("withdrawPage.request.continue")}
          </Button>
        </div>
      </form>

      <Dialog
        open={confirming}
        onOpenChange={(next) => {
          if (!next) setConfirming(false);
        }}
        title={t("withdrawPage.request.confirmTitle")}
        description={t("withdrawPage.request.confirmNote")}
      >
        <div className="flex flex-col gap-4">
          <p className="text-base text-text" data-testid="withdraw-confirm">
            {t("withdrawPage.request.confirmBody", {
              points: formatNumber(points ?? 0),
              amount: moneyText(amountMinor, eligibility.currency),
              destination: destination ? `${destination.methodNameAr} ${destination.masked}` : "",
              hours: formatNumber(eligibility.slaHours),
            })}
          </p>
          {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setConfirming(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              name="confirm-withdraw"
              loading={sending}
              onClick={() => {
                void send();
              }}
            >
              {t("withdrawPage.request.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}

function HistoryCard({ items, onChanged }: { items: Withdrawal[]; onChanged: () => void }) {
  const { toast } = useToast();
  const [failure, setFailure] = useState<unknown>(null);
  const cancel = async (id: string) => {
    setFailure(null);
    try {
      await api(`/me/withdrawals/${id}/cancel`, { method: "POST" });
      toast({ tone: "success", title: t("withdrawPage.history.canceled") });
      onChanged();
    } catch (error) {
      setFailure(error);
    }
  };
  return (
    <Card elevation="card" className="flex flex-col gap-4">
      <h2 className="font-heading text-xl font-bold text-text">{t("withdrawPage.history.title")}</h2>
      {items.length === 0 ? (
        <p className="text-base text-text-muted">{t("withdrawPage.history.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-4" data-testid="withdrawals">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 rounded-md border border-border/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-text" data-testid="withdrawal-status">
                  {t(`withdrawPage.status.${item.status}` as MessageKey)}
                </span>
                <span className="text-sm text-text-muted">{formatDate(item.createdAt)}</span>
              </div>
              <p className="text-base text-text">
                {t("withdrawPage.history.summary", {
                  points: formatNumber(item.points),
                  amount: moneyText(item.amountMinor, item.currency),
                  destination: item.destination.masked,
                })}
              </p>
              {item.transferReference ? (
                <p className="text-sm text-text" data-testid="withdrawal-reference">
                  {t("withdrawPage.history.reference", { reference: item.transferReference })}
                </p>
              ) : null}
              {item.rejectReason ? (
                <p className="text-sm text-text">
                  {t("withdrawPage.history.reason", {
                    reason: t(`rewards.withdrawal.reject.${item.rejectReason}` as MessageKey),
                  })}
                </p>
              ) : null}
              <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-muted">
                {item.timeline.map((step) => (
                  <li key={`${step.status}-${step.at}`}>
                    {`${t(`withdrawPage.status.${step.status}` as MessageKey)} · ${formatDateTime(step.at)}`}
                  </li>
                ))}
              </ol>
              {item.status === "requested" ? (
                <div>
                  <Button
                    variant="ghost"
                    name="cancel-withdrawal"
                    onClick={() => {
                      void cancel(item.id);
                    }}
                  >
                    {t("withdrawPage.history.cancel")}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
    </Card>
  );
}

/**
 * `/rewards/withdraw` (REFERRALS §8.2, §10 block 5): why one can or cannot withdraw, the payout
 * destinations (masked, with their cooldown), the request with a confirmation of the EGP amount and
 * the delay, and the request history. The server decides every amount and every rule.
 */
export function WithdrawView() {
  const eligibility = useResource("/me/withdrawals/eligibility", withdrawalEligibilitySchema);
  const destinations = useResource("/me/payout-destinations", payoutDestinationsSchema);
  const history = useResource("/me/withdrawals", withdrawalListSchema);
  const { reload: reloadEligibility } = eligibility;
  const { reload: reloadDestinations } = destinations;
  const { reload: reloadHistory } = history;
  const changed = useCallback(() => {
    reloadEligibility();
    reloadDestinations();
    reloadHistory();
  }, [reloadEligibility, reloadDestinations, reloadHistory]);

  if (eligibility.status === "loading" || destinations.status === "loading") {
    return (
      <div role="status" aria-label={t("ui.loading")} className="flex flex-col gap-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (eligibility.status === "error") {
    return <ErrorNotice error={eligibility.error} onRetry={eligibility.reload} />;
  }
  if (destinations.status === "error") {
    return <ErrorNotice error={destinations.error} onRetry={destinations.reload} />;
  }
  if (!eligibility.data.available) return <Notice tone="warning">{t("withdrawPage.off")}</Notice>;

  return (
    <div className="flex flex-col gap-6">
      <EligibilityCard eligibility={eligibility.data} />
      <DestinationsCard data={destinations.data} onChanged={changed} />
      <RequestCard
        eligibility={eligibility.data}
        destinations={destinations.data.destinations}
        onRequested={changed}
      />
      {history.status === "ready" ? (
        <HistoryCard items={history.data.items} onChanged={changed} />
      ) : history.status === "error" ? (
        <ErrorNotice error={history.error} onRetry={history.reload} />
      ) : null}
    </div>
  );
}
