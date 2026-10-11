"use client";

import { t } from "@wasfa/shared/i18n";
import {
  providerListResponseSchema,
  providerTestResultSchema,
  type ProviderTestResult,
  type ProviderView,
} from "@wasfa/shared/schemas/admin-ai";
import { Badge, Button, Dialog, useToast, type BadgeTone } from "@wasfa/ui";
import { Pencil, Plug, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { formatNumber, formatRelativeTime } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { useResource } from "../../lib/use-admin-data";
import { errorMessage } from "../error-notice";

import { ProviderForm } from "./ai-provider-form";
import { Code } from "./badges";
import { ConfirmDialog } from "./confirm-dialog";
import { DataTable, type DataTableColumn, type RowAction } from "./data-table";
import { DetailDrawer } from "./drawer";

type Editor = { mode: "create" } | { mode: "edit"; id: string };

interface LastTest {
  ok: boolean;
  at: string;
  errorCode: string | null;
  latencyMs: number | null;
}

/** A fresh result of this session wins over the stored one, which the next load brings up to date. */
function lastTestOf(
  provider: ProviderView,
  fresh: ProviderTestResult | undefined,
): LastTest | null {
  if (fresh) {
    return {
      ok: fresh.ok,
      at: fresh.testedAt,
      errorCode: fresh.errorCode,
      latencyMs: fresh.latencyMs,
    };
  }
  if (provider.lastTestAt === null || provider.lastTestOk === null) return null;
  return {
    ok: provider.lastTestOk,
    at: provider.lastTestAt,
    errorCode: provider.lastTestError,
    latencyMs: null,
  };
}

const POLICY_TONES: Record<ProviderView["dataPolicy"], BadgeTone> = {
  paid_no_training: "info",
  zdr: "info",
  free_tier: "warning",
};

export function AiProvidersView({ canWrite }: { canWrite: boolean }) {
  const resource = useResource("/admin/ai/providers", providerListResponseSchema);
  const { toast } = useToast();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [removing, setRemoving] = useState<ProviderView | null>(null);
  const [removingKey, setRemovingKey] = useState<ProviderView | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Record<string, ProviderTestResult>>({});

  const rows = resource.status === "ready" ? resource.data.items : [];
  // The drawer follows the list, so a saved change or a removed key shows without reopening it.
  const editing = editor?.mode === "edit" ? rows.find((row) => row.id === editor.id) : undefined;

  const test = (provider: ProviderView) => {
    setTestingId(provider.id);
    api(`/admin/ai/providers/${provider.id}/test`, {
      method: "POST",
      schema: providerTestResultSchema,
    }).then(
      (result) => {
        setTestingId(null);
        setFresh((current) => ({ ...current, [provider.id]: result }));
        toast(
          result.ok
            ? {
                tone: "success",
                title: t("admin.ai.providers.testToastOk", {
                  key: provider.key,
                  ms: result.latencyMs,
                }),
              }
            : {
                tone: "error",
                title: t("admin.ai.providers.testToastFailed", { key: provider.key }),
                description: result.errorCode ?? undefined,
              },
        );
        resource.reload();
      },
      (error: unknown) => {
        setTestingId(null);
        toast({ tone: "error", title: errorMessage(error) });
      },
    );
  };

  const columns: DataTableColumn<ProviderView>[] = [
    {
      id: "key",
      header: t("admin.ai.providers.col.key"),
      primary: true,
      cell: (provider) => (
        <span className="flex flex-col gap-1">
          <Code>{provider.key}</Code>
          <span className="text-sm font-normal text-text-muted">
            {t(`admin.ai.kind.${provider.kind}`)} ·{" "}
            {t("admin.ai.providers.priority", { value: provider.priority })}
          </span>
        </span>
      ),
    },
    {
      id: "status",
      header: t("admin.ai.providers.col.status"),
      cell: (provider) => (
        <Badge tone={provider.enabled ? "success" : "neutral"}>
          {t(provider.enabled ? "admin.ai.on" : "admin.ai.off")}
        </Badge>
      ),
    },
    {
      id: "policy",
      header: t("admin.ai.providers.col.policy"),
      cell: (provider) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone={POLICY_TONES[provider.dataPolicy]}>
            {t(`admin.ai.policy.${provider.dataPolicy}`)}
          </Badge>
          {provider.dataPolicy === "free_tier" ? (
            <span className="text-sm text-text-muted">{t("admin.ai.policy.free_tier.note")}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: "apiKey",
      header: t("admin.ai.providers.col.apiKey"),
      cell: (provider) =>
        provider.hasKey && provider.keyHint ? (
          <Code>{provider.keyHint}</Code>
        ) : (
          <span className="text-text-muted">{t("admin.ai.providers.noKey")}</span>
        ),
    },
    {
      id: "lastTest",
      header: t("admin.ai.providers.col.test"),
      cell: (provider) => {
        const last = lastTestOf(provider, fresh[provider.id]);
        if (!last) {
          return <span className="text-text-muted">{t("admin.ai.providers.neverTested")}</span>;
        }
        return (
          <span className="flex flex-col items-start gap-1">
            <Badge tone={last.ok ? "success" : "danger"}>
              {t(last.ok ? "admin.ai.providers.testOk" : "admin.ai.providers.testFailed")}
            </Badge>
            <span className="text-sm text-text-muted">
              {formatRelativeTime(last.at)}
              {last.latencyMs !== null
                ? ` · ${t("admin.ai.providers.latency", { ms: formatNumber(last.latencyMs) })}`
                : ""}
            </span>
            {!last.ok && last.errorCode ? <Code>{last.errorCode}</Code> : null}
          </span>
        );
      },
    },
    {
      id: "models",
      header: t("admin.ai.providers.col.models"),
      cell: (provider) => formatNumber(provider.modelCount),
    },
    ...(canWrite
      ? [
          {
            id: "test",
            header: t("admin.ai.providers.test"),
            cell: (provider: ProviderView) => (
              <Button
                variant="secondary"
                name={`test-${provider.key}`}
                loading={testingId === provider.id}
                disabled={testingId !== null && testingId !== provider.id}
                onClick={() => {
                  test(provider);
                }}
              >
                <Plug aria-hidden className="size-5" />
                {testingId === provider.id
                  ? t("admin.ai.providers.testing")
                  : t("admin.ai.providers.test")}
              </Button>
            ),
          },
        ]
      : []),
  ];

  const rowActions = canWrite
    ? (provider: ProviderView): RowAction[] => [
        {
          id: "edit",
          label: t("admin.ai.providers.edit"),
          icon: Pencil,
          onSelect: () => {
            setEditor({ mode: "edit", id: provider.id });
          },
        },
        {
          id: "delete",
          label: t("admin.ai.providers.delete"),
          icon: Trash2,
          tone: "danger",
          onSelect: () => {
            setRemoving(provider);
          },
        },
      ]
    : undefined;

  const closeEditor = () => {
    setEditor(null);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 max-w-prose text-base text-text-muted">
          {canWrite ? t("admin.ai.providers.lead") : t("admin.ai.providers.readOnlyNote")}
        </p>
        {canWrite ? (
          <Button
            name="new-provider"
            onClick={() => {
              setEditor({ mode: "create" });
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t("admin.ai.providers.add")}
          </Button>
        ) : null}
      </div>

      <DataTable
        caption={t("admin.nav.aiProviders")}
        columns={columns}
        rows={rows}
        rowKey={(provider) => provider.id}
        status={resource.status}
        error={resource.status === "error" ? resource.error : undefined}
        onRetry={resource.reload}
        onOpenRow={
          canWrite
            ? (provider) => {
                setEditor({ mode: "edit", id: provider.id });
              }
            : undefined
        }
        openLabel={(provider) => t("admin.ai.providers.editTitle", { key: provider.key })}
        rowActions={rowActions}
        actionsLabel={(provider) => t("admin.table.actionsFor", { name: provider.key })}
        emptyTitle={t("admin.ai.providers.empty")}
        emptyDescription={t("admin.ai.providers.emptyBody")}
      />

      <Dialog
        open={editor?.mode === "create"}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
        title={t("admin.ai.providers.addTitle")}
      >
        {/* Mounted only while open: every opening starts from an empty form. */}
        {editor?.mode === "create" ? (
          <ProviderForm provider={null} onClose={closeEditor} onSaved={resource.reload} />
        ) : null}
      </Dialog>

      <DetailDrawer
        open={editing !== undefined}
        onClose={closeEditor}
        title={t("admin.ai.providers.editTitle", { key: editing?.key ?? "" })}
      >
        {editing ? (
          <ProviderForm
            key={editing.id}
            provider={editing}
            onClose={closeEditor}
            onSaved={resource.reload}
            onRemoveKey={() => {
              setRemovingKey(editing);
            }}
          />
        ) : null}
      </DetailDrawer>

      <ConfirmDialog
        open={removingKey !== null}
        onOpenChange={(open) => {
          if (!open) setRemovingKey(null);
        }}
        title={t("admin.ai.providers.removeKeyTitle", { key: removingKey?.key ?? "" })}
        description={t("admin.ai.providers.removeKeyBody")}
        confirmLabel={t("admin.ai.providers.removeKey")}
        tone="danger"
        onConfirm={async () => {
          if (!removingKey) return;
          await api(`/admin/ai/providers/${removingKey.id}`, {
            method: "PATCH",
            body: { clearKey: true },
          });
          toast({
            tone: "success",
            title: t("admin.ai.providers.keyRemoved", { key: removingKey.key }),
          });
          resource.reload();
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("admin.ai.providers.deleteTitle", { key: removing?.key ?? "" })}
        description={t("admin.ai.providers.deleteBody")}
        confirmLabel={t("admin.ai.providers.delete")}
        tone="danger"
        onConfirm={async () => {
          if (!removing) return;
          await api(`/admin/ai/providers/${removing.id}`, { method: "DELETE" });
          toast({ tone: "success", title: t("admin.ai.providers.deleted", { key: removing.key }) });
          resource.reload();
        }}
      />
    </div>
  );
}
