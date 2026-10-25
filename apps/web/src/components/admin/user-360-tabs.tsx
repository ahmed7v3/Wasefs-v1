"use client";

import { PHI_ACCESS_REASONS, type PhiAccessReason } from "@wasfa/shared/growth";
import { t, type MessageKey } from "@wasfa/shared/i18n";
import { adminPrescriptionDetailSchema } from "@wasfa/shared/schemas/admin-user-360";
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  Field,
  Select,
  Textarea,
  moneyText,
  useToast,
} from "@wasfa/ui";
import { FileText, Lock, MessagesSquare, Pin } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { z } from "zod";

import { formatDateTime, formatNumber, tOr } from "../../lib/admin-format";
import {
  activePhiSessionSchema,
  chatsPageSchema,
  notesPageSchema,
  phiSessionSchema,
  prescriptionsPageSchema,
  timelinePageSchema,
  userBillingSchema,
  userCreditsSchema,
  userReferralsSchema,
  type TimelineItem,
} from "../../lib/admin-user-360";
import { api } from "../../lib/api-client";
import { useCursorList, useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import { EmptyHint } from "./empty-hint";
import { PrescriptionDetail, RxStatusBadge, usdFromMicros } from "./prescription-detail";
import { ResourceBoundary } from "./resource-boundary";
import { StatusChip } from "./status-chip";

const transcriptSchema = z.object({
  items: z.array(
    z
      .object({ id: z.string(), role: z.string(), content: z.string(), createdAt: z.string() })
      .loose(),
  ),
  nextCursor: z.string().nullable(),
});

function LoadMore({
  list,
}: {
  list: { nextCursor: string | null; loadingMore: boolean; loadMore: () => void };
}) {
  if (!list.nextCursor) return null;
  return (
    <Button variant="secondary" loading={list.loadingMore} onClick={list.loadMore}>
      {t("admin.table.loadMore")}
    </Button>
  );
}

// --- Overview: timeline ------------------------------------------------------------------------------

function timelineText(item: TimelineItem): string {
  const params = Object.fromEntries(
    Object.entries(item.params).map(([key, value]) => [key, String(value ?? "")]),
  );
  return tOr(item.summaryKey, `${item.source} · ${item.kind}`, params);
}

export function TimelineTab({ userId }: { userId: string }) {
  const list = useCursorList(`/admin/users/${userId}/timeline`, "limit=25", timelinePageSchema);
  if (list.status === "error") return <ErrorNotice error={list.error} onRetry={list.reload} />;
  return (
    <section aria-labelledby="timeline-title" className="flex flex-col gap-3">
      <h3 id="timeline-title" className="font-heading text-lg font-semibold text-text">
        {t("admin.user360.timeline")}
      </h3>
      {list.status === "ready" && list.items.length === 0 ? (
        <p className="text-base text-text-muted">{t("admin.user360.timelineEmpty")}</p>
      ) : (
        <ol className="flex flex-col gap-2" data-testid="timeline">
          {list.items.map((item) => (
            <li
              key={`${item.source}-${item.id}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border/50 pb-2"
            >
              <span className="text-sm text-text-muted tabular-nums">
                {formatDateTime(item.occurredAt)}
              </span>
              <span className="rounded bg-neutral-100 px-1.5 text-xs text-text-muted">
                {tOr(`admin.user360.source.${item.source}`, item.source)}
              </span>
              <span className="text-base text-text">{timelineText(item)}</span>
            </li>
          ))}
        </ol>
      )}
      <LoadMore list={list} />
    </section>
  );
}

// --- Billing -----------------------------------------------------------------------------------------------

export function BillingTab({ userId }: { userId: string }) {
  const billing = useResource(`/admin/users/${userId}/billing`, userBillingSchema);
  return (
    <ResourceBoundary resource={billing}>
      {(data) => (
        <div className="flex flex-col gap-5">
          {data.deal ? (
            <Notice tone="info">
              {t("admin.user360.billing.deal", { name: data.deal.name, plan: data.deal.planKey })}
            </Notice>
          ) : null}
          <section className="flex flex-col gap-2">
            <h3 className="font-heading text-lg font-semibold text-text">
              {t("admin.user360.billing.subscriptions")}
            </h3>
            {data.subscriptions.length === 0 ? (
              <p className="text-base text-text-muted">
                {t("admin.user360.billing.noSubscription")}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.subscriptions.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-3">
                    <StatusChip kind="subscription" status={row.status} />
                    <span className="text-base text-text">
                      {tOr(`admin.user360.subscriptionSource.${row.source}`, row.source)}
                    </span>
                    <span className="text-sm text-text-muted tabular-nums">{`${formatDateTime(row.currentPeriodStart)} → ${formatDateTime(row.currentPeriodEnd)}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="font-heading text-lg font-semibold text-text">
              {t("admin.user360.billing.orders")}
            </h3>
            {data.orders.items.length === 0 ? (
              <p className="text-base text-text-muted">{t("admin.user360.billing.noOrders")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.orders.items.map((order) => (
                  <li key={order.id} className="flex flex-wrap items-center gap-3">
                    <bdi dir="ltr" className="font-semibold text-text">
                      {order.number}
                    </bdi>
                    <StatusChip kind="order" status={order.status} />
                    <span className="tabular-nums text-text">
                      {moneyText(order.totalMinor, order.currency)}
                    </span>
                    <span className="text-sm text-text-muted">
                      {formatDateTime(order.paidAt ?? order.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </ResourceBoundary>
  );
}

// --- Credits ----------------------------------------------------------------------------------------------

export function CreditsTab({ userId }: { userId: string }) {
  const credits = useResource(`/admin/users/${userId}/credits`, userCreditsSchema);
  return (
    <ResourceBoundary resource={credits}>
      {(data) => (
        <div className="flex flex-col gap-5">
          <dl className="flex flex-wrap gap-6">
            <div>
              <dt className="text-sm text-text-muted">{t("admin.user360.wallet.personal")}</dt>
              <dd className="font-heading text-2xl font-bold text-text tabular-nums">
                {formatNumber(data.wallets.personal.balance)}
              </dd>
            </div>
            {data.wallets.orgs.map((org) => (
              <div key={org.orgId}>
                <dt className="text-sm text-text-muted">{org.name}</dt>
                <dd className="font-heading text-2xl font-bold text-text tabular-nums">
                  {formatNumber(org.balance)}
                </dd>
              </div>
            ))}
          </dl>
          <section className="flex flex-col gap-2">
            <h3 className="font-heading text-lg font-semibold text-text">
              {t("admin.user360.credits.usage", { days: String(data.usage.days) })}
            </h3>
            {data.usage.items.length === 0 ? (
              <p className="text-base text-text-muted">{t("admin.user360.credits.noUsage")}</p>
            ) : (
              <ul className="grid gap-1 text-sm text-text sm:grid-cols-2">
                {data.usage.items.slice(0, 30).map((row) => (
                  <li key={`${row.day}-${row.task}`} className="tabular-nums">
                    {`${row.day} · ${tOr(`admin.ai.task.${row.task}`, row.task)} · ${formatNumber(row.calls)} · ${formatNumber(row.credits)}`}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="font-heading text-lg font-semibold text-text">
              {t("admin.user360.credits.ledger")}
            </h3>
            <ul className="flex flex-col gap-1 text-sm">
              {data.ledger.items.map((row) => (
                <li key={row.id} className="flex flex-wrap gap-3 tabular-nums">
                  <span className="text-text-muted">{formatDateTime(row.createdAt)}</span>
                  <span className="text-text">
                    {tOr(`admin.credits.kind.${row.kind}`, row.kind)}
                  </span>
                  <span className={row.amount < 0 ? "text-danger" : "text-success"}>
                    {row.amount > 0 ? `+${formatNumber(row.amount)}` : formatNumber(row.amount)}
                  </span>
                  <span className="text-text-muted">{formatNumber(row.balanceAfter)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </ResourceBoundary>
  );
}

// --- Health data (prescriptions, chats) behind an access session -------------------------------------------------

function AccessSessionDialog({
  userId,
  open,
  onClose,
  onStarted,
}: {
  userId: string;
  open: boolean;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [reason, setReason] = useState<PhiAccessReason>("support_request");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const start = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await api(`/admin/users/${userId}/phi-sessions`, {
        method: "POST",
        body: { reason, ...(note.trim() ? { note: note.trim() } : {}) },
        schema: phiSessionSchema,
      });
      onStarted();
      onClose();
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("admin.user360.phi.title")}
      description={t("admin.user360.phi.lead")}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void start();
        }}
      >
        <Field label={t("admin.user360.phi.reason")}>
          {(control) => (
            <Select
              {...control}
              name="phi-reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value as PhiAccessReason);
              }}
            >
              {PHI_ACCESS_REASONS.map((value) => (
                <option key={value} value={value}>
                  {t(`admin.user360.phi.reason.${value}` as MessageKey)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("admin.user360.phi.note")}>
          {(control) => (
            <Textarea
              {...control}
              name="phi-note"
              maxLength={300}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          )}
        </Field>
        {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" name="start-phi-session" loading={busy}>
            {t("admin.user360.phi.start")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function useAccessSession(userId: string) {
  const session = useResource(`/admin/users/${userId}/phi-sessions`, activePhiSessionSchema);
  const active = session.status === "ready" ? session.data.session : null;
  return { active, reload: session.reload };
}

function SessionBar({
  userId,
  active,
  onChange,
}: {
  userId: string;
  active: ReturnType<typeof useAccessSession>["active"];
  onChange: () => void;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-neutral-100 p-3">
      <Lock aria-hidden className="size-4 text-text-muted" />
      {active ? (
        <span className="text-sm text-text" data-testid="phi-session">
          {t("admin.user360.phi.active", {
            reason: t(`admin.user360.phi.reason.${active.reason}` as MessageKey),
            until: formatDateTime(active.expiresAt),
          })}
        </span>
      ) : (
        <>
          <span className="text-sm text-text">{t("admin.user360.phi.none")}</span>
          <Button
            variant="secondary"
            name="open-phi-session"
            onClick={() => {
              setAsking(true);
            }}
          >
            {t("admin.user360.phi.start")}
          </Button>
        </>
      )}
      {asking ? (
        <AccessSessionDialog
          userId={userId}
          open
          onClose={() => {
            setAsking(false);
          }}
          onStarted={onChange}
        />
      ) : null}
    </div>
  );
}

function PrescriptionPanel({
  userId,
  rxId,
  onBack,
}: {
  userId: string;
  rxId: string;
  onBack: () => void;
}) {
  const opened = useResource(
    `/admin/users/${userId}/prescriptions/${rxId}`,
    adminPrescriptionDetailSchema,
  );
  const [refreshed, setRefreshed] = useState(false);
  const refetched = useRef(false);
  const { reload } = opened;
  // A signed picture link lives 60 s: when one fails to load, fetch the analysis again once for fresh links.
  const onExpired = useCallback(() => {
    if (refetched.current) return;
    refetched.current = true;
    setRefreshed(true);
    reload();
  }, [reload]);
  return (
    <ResourceBoundary resource={opened}>
      {(data) => (
        <PrescriptionDetail
          data={data}
          refreshed={refreshed}
          onExpired={onExpired}
          onBack={onBack}
        />
      )}
    </ResourceBoundary>
  );
}

export function PrescriptionsTab({ userId }: { userId: string }) {
  const list = useCursorList(
    `/admin/users/${userId}/prescriptions`,
    "limit=25",
    prescriptionsPageSchema,
  );
  const { active, reload } = useAccessSession(userId);
  const [open, setOpen] = useState<string | null>(null);
  // The analysis the admin clicked before any access session existed: opened as soon as one starts.
  const [pending, setPending] = useState<string | null>(null);
  if (list.status === "error") return <ErrorNotice error={list.error} onRetry={list.reload} />;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <SessionBar userId={userId} active={active} onChange={reload} />
      {open && active ? (
        <PrescriptionPanel
          userId={userId}
          rxId={open}
          onBack={() => {
            setOpen(null);
          }}
        />
      ) : list.status === "ready" && list.items.length === 0 ? (
        <EmptyHint
          icon={<FileText />}
          title={t("admin.user360.rx.empty")}
          hint={t("admin.user360.rx.emptyHint")}
        />
      ) : (
        <ul className="flex flex-col gap-3" data-testid="admin-rx-list">
          {list.items.map((row) => (
            <li
              key={row.id}
              className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold text-text tabular-nums">
                    {formatDateTime(row.createdAt)}
                  </span>
                  <RxStatusBadge status={row.status} />
                  <span className="text-sm text-text-muted">{row.mode}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-muted">
                  <span>
                    {t("admin.user360.rx.pagesCount", { pages: formatNumber(row.pageCount) })}
                  </span>
                  <span>
                    {t("admin.user360.rx.itemsCount", { items: formatNumber(row.itemCount ?? 0) })}
                  </span>
                  <span>
                    {t("admin.user360.rx.confidenceSummary", {
                      low: formatNumber(row.lowConfidence ?? 0),
                      medium: formatNumber(row.mediumConfidence ?? 0),
                    })}
                  </span>
                  <span>
                    {t("admin.user360.rx.credits", { credits: formatNumber(row.credits) })}
                  </span>
                  <span>
                    {t("admin.user360.rx.cost", { cost: usdFromMicros(row.costUsdMicros) })}
                  </span>
                </div>
              </div>
              <Button
                variant="secondary"
                name="open-rx"
                className="w-full sm:w-auto"
                aria-label={`${t("admin.user360.rx.opening")} · ${formatDateTime(row.createdAt)}`}
                onClick={() => {
                  if (active) setOpen(row.id);
                  else setPending(row.id);
                }}
              >
                {t("admin.user360.rx.open")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {open ? null : <LoadMore list={list} />}
      {pending ? (
        <AccessSessionDialog
          userId={userId}
          open
          onClose={() => {
            setPending(null);
          }}
          onStarted={() => {
            reload();
            setOpen(pending);
          }}
        />
      ) : null}
    </div>
  );
}

function TranscriptViewer({
  userId,
  chatId,
  onClose,
}: {
  userId: string;
  chatId: string;
  onClose: () => void;
}) {
  const transcript = useResource(`/admin/users/${userId}/chats/${chatId}`, transcriptSchema);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("admin.user360.chat.title")}
      className="max-w-3xl"
    >
      <ResourceBoundary resource={transcript}>
        {(data) => (
          <ol className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
            {data.items.map((message) => (
              <li
                key={message.id}
                className={
                  message.role === "user"
                    ? "rounded-md bg-primary-soft p-3"
                    : "rounded-md bg-neutral-100 p-3"
                }
              >
                <p className="text-xs text-text-muted">{`${message.role} · ${formatDateTime(message.createdAt)}`}</p>
                <p className="whitespace-pre-wrap text-base text-text">{message.content}</p>
              </li>
            ))}
          </ol>
        )}
      </ResourceBoundary>
    </Dialog>
  );
}

export function ChatsTab({ userId }: { userId: string }) {
  const list = useCursorList(`/admin/users/${userId}/chats`, "limit=25", chatsPageSchema);
  const { active, reload } = useAccessSession(userId);
  const [open, setOpen] = useState<string | null>(null);
  if (list.status === "error") return <ErrorNotice error={list.error} onRetry={list.reload} />;
  return (
    <div className="flex flex-col gap-4">
      <SessionBar userId={userId} active={active} onChange={reload} />
      {list.status === "ready" && list.items.length === 0 ? (
        <EmptyHint
          icon={<MessagesSquare />}
          title={t("admin.user360.chat.empty")}
          hint={t("admin.user360.chat.emptyHint")}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.items.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 p-3"
            >
              <span className="text-sm text-text tabular-nums">{`${formatDateTime(row.updatedAt)} · ${t("admin.user360.chat.messages", { count: formatNumber(row.messageCount) })}`}</span>
              <Button
                variant="secondary"
                name="open-chat"
                disabled={!active}
                onClick={() => {
                  setOpen(row.id);
                }}
              >
                {t("admin.user360.chat.open")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <LoadMore list={list} />
      {open && active ? (
        <TranscriptViewer
          userId={userId}
          chatId={open}
          onClose={() => {
            setOpen(null);
          }}
        />
      ) : null}
    </div>
  );
}

// --- Referrals --------------------------------------------------------------------------------------------------

export function ReferralsTab({ userId }: { userId: string }) {
  const data = useResource(`/admin/users/${userId}/referrals`, userReferralsSchema);
  return (
    <ResourceBoundary resource={data}>
      {(value) => (
        <div className="flex flex-col gap-4">
          <dl className="flex flex-wrap gap-6">
            <div>
              <dt className="text-sm text-text-muted">{t("admin.user360.referrals.code")}</dt>
              <dd className="font-semibold text-text">
                <bdi dir="ltr">{value.code?.code ?? "—"}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-text-muted">{t("admin.user360.referrals.invitedBy")}</dt>
              <dd className="text-text">{value.invitedBy?.referrerInitials ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-text-muted">{t("admin.user360.referrals.cash")}</dt>
              <dd className="text-text tabular-nums">{formatNumber(value.wallet.cash)}</dd>
            </div>
            <div>
              <dt className="text-sm text-text-muted">{t("admin.user360.referrals.pending")}</dt>
              <dd className="text-text tabular-nums">{formatNumber(value.wallet.pending)}</dd>
            </div>
            <div>
              <dt className="text-sm text-text-muted">{t("admin.user360.referrals.creditOnly")}</dt>
              <dd className="text-text tabular-nums">{formatNumber(value.wallet.creditOnly)}</dd>
            </div>
          </dl>
          <h3 className="font-heading text-lg font-semibold text-text">
            {t("admin.user360.referrals.invitees")}
          </h3>
          {value.invitees.length === 0 ? (
            <p className="text-base text-text-muted">{t("admin.user360.referrals.noInvitees")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {value.invitees.map((row) => (
                <li key={row.referralId} className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-semibold text-text">{row.initials}</span>
                  <StatusChip kind="referral" status={row.status} />
                  <span className="tabular-nums text-text-muted">
                    {t("admin.user360.referrals.points", {
                      pending: formatNumber(row.pendingPoints),
                      settled: formatNumber(row.settledPoints),
                    })}
                  </span>
                  {(row.flags ?? []).map((flag) => (
                    <span key={flag} className="rounded bg-warning-soft px-1.5 text-text">
                      {tOr(`admin.growth.flag.${flag}`, flag)}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </ResourceBoundary>
  );
}

// --- Notes ------------------------------------------------------------------------------------------------------

export function NotesTab({ userId }: { userId: string }) {
  const { toast } = useToast();
  const list = useCursorList(`/admin/users/${userId}/notes`, "limit=25", notesPageSchema);
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const add = async () => {
    if (body.trim() === "") return;
    setBusy(true);
    setFailure(null);
    try {
      await api(`/admin/users/${userId}/notes`, {
        method: "POST",
        body: { body: body.trim(), pinned },
      });
      setBody("");
      setPinned(false);
      toast({ tone: "success", title: t("admin.user360.notes.saved") });
      list.reload();
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <Card elevation="flat" className="flex flex-col gap-3">
        <Field label={t("admin.user360.notes.new")}>
          {(control) => (
            <Textarea
              {...control}
              name="note-body"
              maxLength={4000}
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
              }}
            />
          )}
        </Field>
        <Checkbox
          name="note-pinned"
          label={t("admin.user360.notes.pin")}
          checked={pinned}
          onChange={(event) => {
            setPinned(event.target.checked);
          }}
        />
        {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
        <div>
          <Button
            name="add-note"
            loading={busy}
            disabled={body.trim() === ""}
            onClick={() => {
              void add();
            }}
          >
            {t("admin.user360.notes.add")}
          </Button>
        </div>
      </Card>
      {list.status === "error" ? <ErrorNotice error={list.error} onRetry={list.reload} /> : null}
      <ul className="flex flex-col gap-2">
        {list.items.map((note) => (
          <li key={note.id} className="flex flex-col gap-1 rounded-md border border-border/60 p-3">
            <span className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
              {note.pinned ? (
                <Pin aria-label={t("admin.user360.notes.pinned")} className="size-4 text-primary" />
              ) : null}
              <span>{note.authorName ?? "—"}</span>
              <span className="tabular-nums">{formatDateTime(note.createdAt)}</span>
            </span>
            <p className="whitespace-pre-wrap text-base text-text">{note.body}</p>
          </li>
        ))}
      </ul>
      <LoadMore list={list} />
    </div>
  );
}
