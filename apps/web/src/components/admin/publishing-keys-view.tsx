"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { PUBLISHING_DEFAULTS } from "@wasfa/shared/publishing";
import {
  publishingKeyIssuedSchema,
  publishingKeyListSchema,
  publishingKeySchema,
  type PublishingKey,
  type PublishingKeyIssued,
} from "@wasfa/shared/schemas/admin-publishing-keys";
import { Badge, Button, Field, Input, useToast, type BadgeTone } from "@wasfa/ui";
import { History, KeyRound, Pencil, Plus, RefreshCw, ShieldOff } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { ApiRequestError } from "../../lib/api-error";
import { keyStatus, maskedKey, type PublishingKeyStatus } from "../../lib/publishing-admin";
import { useResource } from "../../lib/use-admin-data";

import { ConfirmDialog } from "./confirm-dialog";
import { DataTable, type DataTableColumn, type RowAction } from "./data-table";
import { KeyFormDialog } from "./publishing-key-form-dialog";
import { KeyRequestsDialog } from "./publishing-key-requests-dialog";
import { KeySecretDialog } from "./publishing-key-secret-dialog";

const STATUS_TONE: Record<PublishingKeyStatus, BadgeTone> = {
  active: "success",
  expiring: "warning",
  expired: "danger",
  revoked: "neutral",
};

const dateText = (iso: string) => new Date(iso).toLocaleString("en-GB");

function KeyStatusBadge({ item }: { item: PublishingKey }) {
  const status = keyStatus(item);
  return <Badge tone={STATUS_TONE[status]}>{t(`admin.pub.status.${status}` as MessageKey)}</Badge>;
}

/** `/admin/content/api-keys`: the keys AI agents use to reach the Publishing API. */
export function PublishingKeysView() {
  const resource = useResource("/admin/content/api-keys", publishingKeyListSchema);
  const { toast } = useToast();
  const [form, setForm] = useState<{ key: PublishingKey | null } | null>(null);
  const [revoking, setRevoking] = useState<PublishingKey | null>(null);
  const [rotating, setRotating] = useState<PublishingKey | null>(null);
  const [graceHours, setGraceHours] = useState(String(PUBLISHING_DEFAULTS.rotateGraceHours));
  const [viewing, setViewing] = useState<PublishingKey | null>(null);
  // The one-time secret: component state only, cleared on close, never persisted.
  const [issued, setIssued] = useState<PublishingKeyIssued | null>(null);

  const rows = resource.status === "ready" ? resource.data.items : [];

  const columns: DataTableColumn<PublishingKey>[] = [
    {
      id: "name",
      header: t("admin.pub.col.name"),
      primary: true,
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{row.name}</span>
          <Badge tone={row.environment === "live" ? "info" : "neutral"}>
            {t(`admin.pub.env.${row.environment}`)}
          </Badge>
        </span>
      ),
    },
    {
      id: "key",
      header: t("admin.pub.col.key"),
      cell: (row) => (
        <bdi dir="ltr" className="font-mono text-sm">
          {maskedKey(row)}
        </bdi>
      ),
    },
    {
      id: "scopes",
      header: t("admin.pub.col.scopes"),
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.scopes.map((scope) => (
            <Badge key={scope} tone="neutral">
              <bdi dir="ltr">{scope}</bdi>
            </Badge>
          ))}
        </span>
      ),
    },
    {
      id: "publish",
      header: t("admin.pub.col.publish"),
      cell: (row) => (
        <Badge tone={row.canPublish ? "warning" : "neutral"}>
          {row.canPublish ? t("admin.pub.canPublish.yes") : t("admin.pub.canPublish.no")}
        </Badge>
      ),
    },
    {
      id: "status",
      header: t("admin.pub.col.status"),
      cell: (row) => (
        <span className="flex flex-col gap-1">
          <KeyStatusBadge item={row} />
          <span className="text-sm text-text-muted">
            {t("admin.pub.expiresOn", { date: dateText(row.expiresAt) })}
          </span>
          {row.rotationGraceUntil && new Date(row.rotationGraceUntil) > new Date() ? (
            <span className="text-sm text-warning">
              {t("admin.pub.status.grace", { date: dateText(row.rotationGraceUntil) })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "lastUsed",
      header: t("admin.pub.col.lastUsed"),
      cell: (row) => (row.lastUsedAt ? dateText(row.lastUsedAt) : t("admin.pub.neverUsed")),
    },
    {
      id: "today",
      header: t("admin.pub.col.today"),
      cell: (row) =>
        t("admin.pub.usage.today", {
          requests: row.usage.requestsToday,
          errors: row.usage.errorsToday,
          published: row.usage.publishedToday,
        }),
    },
    { id: "owner", header: t("admin.pub.col.owner"), cell: (row) => row.ownerName ?? "" },
  ];

  const actions = (row: PublishingKey): RowAction[] => {
    const list: RowAction[] = [
      {
        id: "requests",
        label: t("admin.pub.action.requests"),
        icon: History,
        onSelect: () => {
          setViewing(row);
        },
      },
    ];
    if (row.revokedAt === null) {
      list.unshift(
        {
          id: "edit",
          label: t("admin.pub.action.edit"),
          icon: Pencil,
          onSelect: () => {
            setForm({ key: row });
          },
        },
        {
          id: "rotate",
          label: t("admin.pub.action.rotate"),
          icon: RefreshCw,
          onSelect: () => {
            setGraceHours(String(PUBLISHING_DEFAULTS.rotateGraceHours));
            setRotating(row);
          },
        },
      );
      list.push({
        id: "revoke",
        label: t("admin.pub.action.revoke"),
        icon: ShieldOff,
        tone: "danger",
        onSelect: () => {
          setRevoking(row);
        },
      });
    }
    return list;
  };

  const grace = Number(graceHours);
  const graceValid =
    graceHours.trim() !== "" &&
    Number.isInteger(grace) &&
    grace >= 0 &&
    grace <= PUBLISHING_DEFAULTS.rotateGraceMaxHours;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text">
          <KeyRound aria-hidden className="size-6" />
          {t("admin.pub.keys.title")}
        </h1>
        <Button
          type="button"
          name="create-key"
          onClick={() => {
            setForm({ key: null });
          }}
        >
          <Plus aria-hidden className="size-5" />
          {t("admin.pub.keys.create")}
        </Button>
      </div>
      <p className="text-base text-text-muted">
        {t("admin.pub.keys.intro")}{" "}
        <Link href="/admin/content/api" className="font-semibold text-primary underline">
          {t("admin.pub.keys.connectLink")}
        </Link>
      </p>

      <DataTable
        caption={t("admin.pub.keys.table")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        status={resource.status}
        error={resource.status === "error" ? resource.error : undefined}
        onRetry={resource.reload}
        rowActions={actions}
        actionsLabel={(row) => t("admin.pub.action.menu", { name: row.name })}
        emptyTitle={t("admin.pub.keys.empty.title")}
        emptyDescription={t("admin.pub.keys.empty.description")}
      />

      <KeyFormDialog
        target={form}
        onClose={() => {
          setForm(null);
        }}
        onIssued={setIssued}
        onSaved={resource.reload}
      />

      <KeySecretDialog
        issued={issued}
        onClose={() => {
          setIssued(null);
        }}
      />

      <KeyRequestsDialog
        target={viewing}
        onClose={() => {
          setViewing(null);
        }}
      />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={t("admin.pub.revoke.title", { name: revoking?.name ?? "" })}
        description={t("admin.pub.revoke.description")}
        confirmLabel={t("admin.pub.revoke.confirm")}
        tone="danger"
        onConfirm={async () => {
          if (!revoking) return;
          await api(`/admin/content/api-keys/${revoking.id}/revoke`, {
            method: "POST",
            schema: publishingKeySchema,
          });
          toast({ tone: "success", title: t("admin.pub.revoke.done") });
          resource.reload();
        }}
      />

      <ConfirmDialog
        open={rotating !== null}
        onOpenChange={(open) => {
          if (!open) setRotating(null);
        }}
        title={t("admin.pub.rotate.title", { name: rotating?.name ?? "" })}
        description={t("admin.pub.rotate.description")}
        confirmLabel={t("admin.pub.rotate.confirm")}
        onConfirm={async () => {
          if (!rotating) return;
          if (!graceValid)
            throw new ApiRequestError(
              "VALIDATION_FAILED",
              t("admin.pub.form.invalid"),
              undefined,
              422,
            );
          const next = await api(`/admin/content/api-keys/${rotating.id}/rotate`, {
            method: "POST",
            body: { graceHours: grace },
            schema: publishingKeyIssuedSchema,
          });
          setIssued(next);
          resource.reload();
        }}
      >
        <Field
          label={t("admin.pub.rotate.graceHours")}
          hint={t("admin.pub.rotate.graceHint", { max: PUBLISHING_DEFAULTS.rotateGraceMaxHours })}
          error={graceValid ? undefined : t("admin.pub.form.invalid")}
        >
          {(control) => (
            <Input
              {...control}
              name="graceHours"
              type="number"
              inputMode="numeric"
              min={0}
              max={PUBLISHING_DEFAULTS.rotateGraceMaxHours}
              dir="ltr"
              value={graceHours}
              onChange={(event) => {
                setGraceHours(event.target.value);
              }}
            />
          )}
        </Field>
      </ConfirmDialog>
    </div>
  );
}
