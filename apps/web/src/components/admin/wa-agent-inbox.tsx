"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import {
  pauseConversationSchema,
  waAgentConversationPageSchema,
  waAgentConversationStateSchema,
  waAgentMediaUrlSchema,
  waAgentMessagePageSchema,
  WA_AGENT_PAUSE_MAX_MINUTES,
  WA_AGENT_PAUSE_MIN_MINUTES,
  type WaAgentConversation,
  type WaAgentConversationState,
  type WaAgentMessage,
} from "@wasfa/shared/schemas/admin-wa-agent";
import { WA_AGENT_CONVERSATION_STATUSES } from "@wasfa/shared/schemas/wa-agent";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Dialog,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  cn,
  useToast,
  type BadgeTone,
} from "@wasfa/ui";
import { MessagesSquare, Search } from "lucide-react";
import { useState, type FormEvent } from "react";

import { formatDateTime, formatRelativeTime, tOr } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { useReauth } from "../../lib/reauth";
import { buildQuery, useCursorList } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { ConfirmDialog } from "./confirm-dialog";

const STATUS_TONES: Record<WaAgentConversation["status"], BadgeTone> = {
  active: "success",
  paused: "warning",
  blocked: "danger",
};

const STATUS_LABELS = {
  active: "admin.waAgent.inbox.status.active",
  paused: "admin.waAgent.inbox.status.paused",
  blocked: "admin.waAgent.inbox.status.blocked",
} as const satisfies Record<WaAgentConversation["status"], MessageKey>;

const DIRECTION_LABELS = {
  in: "admin.waAgent.inbox.from.customer",
  out: "admin.waAgent.inbox.from.agent",
  owner: "admin.waAgent.inbox.from.owner",
} as const satisfies Record<WaAgentMessage["direction"], MessageKey>;

const KIND_LABELS = {
  text: "admin.waAgent.inbox.kind.text",
  image: "admin.waAgent.inbox.kind.image",
  audio: "admin.waAgent.inbox.kind.audio",
  document: "admin.waAgent.inbox.kind.document",
  other: "admin.waAgent.inbox.kind.other",
} as const satisfies Record<WaAgentMessage["kind"], MessageKey>;

const BUBBLE_STYLES: Record<WaAgentMessage["direction"], string> = {
  in: "self-start bg-neutral-100",
  out: "self-end bg-primary-soft",
  owner: "self-end bg-accent-soft",
};

/** Pause lengths offered as presets, minutes; `custom` asks for a number. */
const PAUSE_PRESETS = [60, 120, 1_440] as const;

function PauseDialog({
  conversation,
  open,
  onOpenChange,
  onDone,
}: {
  conversation: WaAgentConversation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (state: WaAgentConversationState) => void;
}) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [preset, setPreset] = useState<string>("120");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const minutes = preset === "custom" ? Number(custom) : Number(preset);
  const valid = pauseConversationSchema.safeParse({ minutes }).success;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    setFailure(null);
    try {
      const state = await reauth.run(() =>
        api(`/admin/wa-agent/conversations/${conversation.id}/pause`, {
          method: "POST",
          body: { minutes },
          schema: waAgentConversationStateSchema,
        }),
      );
      toast({ tone: "success", title: t("admin.waAgent.inbox.paused") });
      onOpenChange(false);
      onDone(state);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("admin.waAgent.inbox.pauseTitle")}
      description={t("admin.waAgent.inbox.pauseBody")}
    >
      <form
        aria-label={t("admin.waAgent.inbox.pauseTitle")}
        onSubmit={(event) => {
          void submit(event);
        }}
        noValidate
        className="flex flex-col gap-4"
      >
        <Field label={t("admin.waAgent.inbox.pauseFor")}>
          {(control) => (
            <Select
              {...control}
              name="pause-preset"
              value={preset}
              onChange={(event) => {
                setPreset(event.target.value);
              }}
            >
              {PAUSE_PRESETS.map((value) => (
                <option key={value} value={String(value)}>
                  {t(`admin.waAgent.inbox.preset.${value}`)}
                </option>
              ))}
              <option value="custom">{t("admin.waAgent.inbox.preset.custom")}</option>
            </Select>
          )}
        </Field>
        {preset === "custom" ? (
          <Field
            label={t("admin.waAgent.inbox.customMinutes")}
            hint={t("admin.waAgent.range", {
              min: WA_AGENT_PAUSE_MIN_MINUTES,
              max: WA_AGENT_PAUSE_MAX_MINUTES,
            })}
            error={custom !== "" && !valid ? t("admin.waAgent.invalid") : undefined}
          >
            {(control) => (
              <Input
                {...control}
                name="pause-minutes"
                inputMode="numeric"
                dir="ltr"
                value={custom}
                onChange={(event) => {
                  setCustom(event.target.value);
                }}
              />
            )}
          </Field>
        ) : null}
        {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" name="pause-confirm" loading={busy} disabled={!valid}>
            {t("admin.waAgent.inbox.pause")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Bubble({
  message,
  onOpenMedia,
}: {
  message: WaAgentMessage;
  onOpenMedia: (messageId: string) => void;
}) {
  const dropped = message.status === "dropped";
  return (
    <li
      data-direction={message.direction}
      data-status={message.status}
      className={cn(
        "flex max-w-[85%] flex-col gap-1 rounded-lg px-3 py-2",
        BUBBLE_STYLES[message.direction],
        dropped && "opacity-60",
      )}
    >
      <p className="text-sm font-semibold text-text-muted">
        {t(DIRECTION_LABELS[message.direction])}
        {" · "}
        <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
      </p>
      {message.text ? (
        <p dir="auto" className="whitespace-pre-wrap break-words text-base text-text">
          {message.text}
        </p>
      ) : (
        <p className="text-base text-text-muted">{t(KIND_LABELS[message.kind])}</p>
      )}
      {message.hasMedia ? (
        <div>
          <Button
            type="button"
            variant="secondary"
            name={`open-media-${message.id}`}
            onClick={() => {
              onOpenMedia(message.id);
            }}
          >
            {t(
              `admin.waAgent.inbox.open.${message.kind === "audio" ? "audio" : message.kind === "document" ? "document" : "image"}`,
            )}
          </Button>
        </div>
      ) : null}
      {message.tools.length > 0 ? (
        <p className="text-sm text-text-muted">
          {t("admin.waAgent.inbox.tools", { tools: message.tools.join("، ") })}
        </p>
      ) : null}
      {dropped ? (
        <p className="text-sm font-semibold text-danger">
          {t("admin.waAgent.inbox.dropped", {
            reason: tOr(
              `admin.waAgent.drop.${message.dropReason ?? "unknown"}`,
              message.dropReason ?? "unknown",
            ),
          })}
        </p>
      ) : null}
    </li>
  );
}

function Transcript({
  conversation,
  canWrite,
  onState,
}: {
  conversation: WaAgentConversation;
  canWrite: boolean;
  onState: (state: WaAgentConversationState) => void;
}) {
  const reauth = useReauth();
  const { toast } = useToast();
  const list = useCursorList(
    `/admin/wa-agent/conversations/${conversation.id}/messages`,
    "",
    waAgentMessagePageSchema,
  );
  const [pausing, setPausing] = useState(false);
  const [confirming, setConfirming] = useState<"block" | "unblock" | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  const openMedia = (messageId: string) => {
    setFailure(null);
    api(`/admin/wa-agent/messages/${messageId}/media-url`, { schema: waAgentMediaUrlSchema }).then(
      ({ url }) => {
        window.open(url, "_blank", "noopener,noreferrer");
      },
      (error: unknown) => {
        setFailure(error);
      },
    );
  };

  const act = async (action: "resume" | "block" | "unblock"): Promise<void> => {
    const state = await reauth.run(() =>
      api(`/admin/wa-agent/conversations/${conversation.id}/${action}`, {
        method: "POST",
        schema: waAgentConversationStateSchema,
      }),
    );
    toast({ tone: "success", title: t(`admin.waAgent.inbox.done.${action}`) });
    onState(state);
  };

  const resume = async (): Promise<void> => {
    setFailure(null);
    try {
      await act("resume");
    } catch (error) {
      setFailure(error);
    }
  };

  // Newest first from the API; read top to bottom here.
  const messages = [...list.items].reverse();
  const heldUntil =
    conversation.status === "paused" && conversation.pausedUntil
      ? formatDateTime(conversation.pausedUntil)
      : null;

  return (
    <Card elevation="flat" padding="compact" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>
            <bdi dir="ltr" className="font-mono">
              {conversation.phone ?? t("admin.waAgent.inbox.noPhone")}
            </bdi>
          </CardTitle>
          <p className="text-sm text-text-muted">
            {conversation.user
              ? t("admin.waAgent.inbox.linkedTo", { name: conversation.user.name })
              : t("admin.waAgent.inbox.guest")}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={STATUS_TONES[conversation.status]}>
            {t(STATUS_LABELS[conversation.status])}
          </Badge>
          {heldUntil ? (
            <p className="text-sm text-text-muted">
              {t("admin.waAgent.inbox.pausedUntil", { time: heldUntil })}
            </p>
          ) : null}
        </div>
      </div>

      {canWrite ? (
        <div className="flex flex-wrap gap-3">
          {conversation.status === "blocked" ? (
            <Button
              type="button"
              variant="secondary"
              name="unblock"
              onClick={() => {
                setConfirming("unblock");
              }}
            >
              {t("admin.waAgent.inbox.unblock")}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                name="pause"
                onClick={() => {
                  setPausing(true);
                }}
              >
                {t("admin.waAgent.inbox.pause")}
              </Button>
              {conversation.status === "paused" ? (
                <Button
                  type="button"
                  variant="secondary"
                  name="resume"
                  onClick={() => {
                    void resume();
                  }}
                >
                  {t("admin.waAgent.inbox.resume")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="danger"
                name="block"
                onClick={() => {
                  setConfirming("block");
                }}
              >
                {t("admin.waAgent.inbox.block")}
              </Button>
            </>
          )}
        </div>
      ) : null}
      {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}

      {list.status === "loading" ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <p className="sr-only" role="status">
            {t("ui.loading")}
          </p>
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-12 w-1/2 self-end" />
        </div>
      ) : list.status === "error" ? (
        <ErrorNotice error={list.error} onRetry={list.reload} />
      ) : (
        <div className="flex flex-col gap-3">
          {list.nextCursor ? (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="ghost"
                name="load-older"
                loading={list.loadingMore}
                onClick={list.loadMore}
              >
                {t("admin.waAgent.inbox.older")}
              </Button>
            </div>
          ) : null}
          {list.loadMoreError ? (
            <ErrorNotice error={list.loadMoreError} supportHref={null} />
          ) : null}
          {messages.length === 0 ? (
            <p className="text-base text-text-muted">{t("admin.waAgent.inbox.noMessages")}</p>
          ) : (
            <ul aria-label={t("admin.waAgent.inbox.transcript")} className="flex flex-col gap-3">
              {messages.map((message) => (
                <Bubble key={message.id} message={message} onOpenMedia={openMedia} />
              ))}
            </ul>
          )}
        </div>
      )}

      <PauseDialog
        conversation={conversation}
        open={pausing}
        onOpenChange={setPausing}
        onDone={onState}
      />
      <ConfirmDialog
        open={confirming === "block"}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={t("admin.waAgent.inbox.blockTitle")}
        description={t("admin.waAgent.inbox.blockBody")}
        confirmLabel={t("admin.waAgent.inbox.block")}
        tone="danger"
        onConfirm={() => act("block")}
      />
      <ConfirmDialog
        open={confirming === "unblock"}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={t("admin.waAgent.inbox.unblockTitle")}
        description={t("admin.waAgent.inbox.unblockBody")}
        confirmLabel={t("admin.waAgent.inbox.unblock")}
        onConfirm={() => act("unblock")}
      />
    </Card>
  );
}

/** The Inbox tab: chats with filters and search, and the transcript of the chosen one. */
export function WaAgentInboxTab({ canWrite }: { canWrite: boolean }) {
  const [status, setStatus] = useState("");
  const [linked, setLinked] = useState("");
  const [draftQ, setDraftQ] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<WaAgentConversation | null>(null);

  const list = useCursorList(
    "/admin/wa-agent/conversations",
    buildQuery({ status, linked, q }),
    waAgentConversationPageSchema,
  );

  // The list refreshes after an action; fall back to what was clicked when the chat left the page.
  const current = selected
    ? (list.items.find((item) => item.id === selected.id) ?? selected)
    : null;

  const applyState = (state: WaAgentConversationState) => {
    setSelected((previous) =>
      previous && previous.id === state.id
        ? { ...previous, status: state.status, pausedUntil: state.pausedUntil }
        : previous,
    );
    list.reload();
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    setQ(draftQ.trim());
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <form
          aria-label={t("admin.waAgent.inbox.filters")}
          onSubmit={search}
          className="flex flex-col gap-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("admin.waAgent.inbox.filter.status")}>
              {(control) => (
                <Select
                  {...control}
                  name="status"
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value);
                  }}
                >
                  <option value="">{t("admin.waAgent.inbox.filter.all")}</option>
                  {WA_AGENT_CONVERSATION_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {t(STATUS_LABELS[value])}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("admin.waAgent.inbox.filter.linked")}>
              {(control) => (
                <Select
                  {...control}
                  name="linked"
                  value={linked}
                  onChange={(event) => {
                    setLinked(event.target.value);
                  }}
                >
                  <option value="">{t("admin.waAgent.inbox.filter.all")}</option>
                  <option value="true">{t("admin.waAgent.inbox.filter.linkedYes")}</option>
                  <option value="false">{t("admin.waAgent.inbox.filter.linkedNo")}</option>
                </Select>
              )}
            </Field>
          </div>
          <div className="flex items-end gap-2">
            <Field label={t("admin.waAgent.inbox.search")} className="min-w-0 flex-1">
              {(control) => (
                <Input
                  {...control}
                  name="q"
                  type="search"
                  autoComplete="off"
                  placeholder={t("admin.waAgent.inbox.searchHint")}
                  value={draftQ}
                  onChange={(event) => {
                    setDraftQ(event.target.value);
                  }}
                />
              )}
            </Field>
            <Button type="submit" variant="secondary" name="search">
              <Search aria-hidden className="size-5" />
              {t("admin.waAgent.inbox.searchButton")}
            </Button>
          </div>
        </form>

        {list.status === "loading" ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <p className="sr-only" role="status">
              {t("ui.loading")}
            </p>
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : list.status === "error" ? (
          <ErrorNotice error={list.error} onRetry={list.reload} />
        ) : list.items.length === 0 ? (
          <Card elevation="flat">
            <EmptyState
              icon={<MessagesSquare />}
              title={t("admin.waAgent.inbox.empty")}
              description={t("admin.waAgent.inbox.emptyHint")}
            />
          </Card>
        ) : (
          <ul aria-label={t("admin.waAgent.inbox.list")} className="flex flex-col gap-2">
            {list.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={current?.id === item.id ? "true" : undefined}
                  onClick={() => {
                    setSelected(item);
                  }}
                  className={cn(
                    "flex min-h-16 w-full flex-col gap-1 rounded-lg border p-3 text-start transition-colors duration-150 hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus",
                    current?.id === item.id
                      ? "border-primary bg-primary-soft"
                      : "border-neutral-200",
                  )}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-base font-semibold text-text">
                      <bdi dir="ltr" className="font-mono">
                        {item.phone ?? t("admin.waAgent.inbox.noPhone")}
                      </bdi>
                      {item.user ? ` · ${item.user.name}` : ""}
                    </span>
                    <Badge tone={STATUS_TONES[item.status]}>{t(STATUS_LABELS[item.status])}</Badge>
                  </span>
                  {item.preview ? (
                    <span dir="auto" className="truncate text-sm text-text-muted">
                      {item.preview}
                    </span>
                  ) : null}
                  {item.lastInboundAt ? (
                    <span className="text-sm text-text-muted">
                      {formatRelativeTime(item.lastInboundAt)}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
        {list.nextCursor ? (
          <Button
            type="button"
            variant="ghost"
            name="load-more"
            loading={list.loadingMore}
            onClick={list.loadMore}
          >
            {t("admin.waAgent.inbox.more")}
          </Button>
        ) : null}
        {list.loadMoreError ? <ErrorNotice error={list.loadMoreError} supportHref={null} /> : null}
      </div>

      {current ? (
        <Transcript
          key={current.id}
          conversation={current}
          canWrite={canWrite}
          onState={applyState}
        />
      ) : (
        <Card elevation="flat">
          <EmptyState
            icon={<MessagesSquare />}
            title={t("admin.waAgent.inbox.pick")}
            description={t("admin.waAgent.inbox.pickHint")}
          />
        </Card>
      )}
    </div>
  );
}
