"use client";

import { t } from "@wasfa/shared/i18n";
import {
  modelListResponseSchema,
  modelViewSchema,
  providerListResponseSchema,
  type ModelView,
  type ModelWarning,
} from "@wasfa/shared/schemas/admin-ai";
import { Badge, Button, Dialog, Field, Select, useToast, type BadgeTone } from "@wasfa/ui";
import { Pencil, Plus, Power, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { formatMultiplier, formatUsd } from "../../lib/ai-admin";
import { api } from "../../lib/api-client";
import { useReauth } from "../../lib/reauth";
import { buildQuery, useResource } from "../../lib/use-admin-data";
import { errorMessage } from "../error-notice";

import { ModelForm } from "./ai-model-form";
import { PriceSyncDialog } from "./ai-price-sync-dialog";
import { Code } from "./badges";
import { ConfirmDialog } from "./confirm-dialog";
import { DataTable, type DataTableColumn, type RowAction } from "./data-table";
import { DetailDrawer } from "./drawer";

type Editor = { mode: "create" } | { mode: "edit"; id: string };

const WARNING_TONES: Record<ModelWarning, BadgeTone> = {
  unpriced: "danger",
  price_stale: "warning",
  preview: "info",
  provider_disabled: "warning",
};

function Price({ label, micros }: { label: string; micros: number | null }) {
  return (
    <span className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-text-muted">{label}</span>
      <span dir="ltr" className="tabular-nums">
        {micros === null ? "—" : formatUsd(micros)}
      </span>
    </span>
  );
}

export function AiModelsView({ canWrite }: { canWrite: boolean }) {
  const [providerId, setProviderId] = useState("");
  const providers = useResource("/admin/ai/providers", providerListResponseSchema);
  const query = buildQuery({ providerId });
  const resource = useResource(
    query === "" ? "/admin/ai/models" : `/admin/ai/models?${query}`,
    modelListResponseSchema,
  );
  const { toast } = useToast();
  const reauth = useReauth();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [removing, setRemoving] = useState<ModelView | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Grouped by provider, then by name, so the filter and the plain list read the same way.
  const rows =
    resource.status === "ready"
      ? [...resource.data.items].sort(
          (a, b) =>
            a.provider.key.localeCompare(b.provider.key) ||
            a.displayName.localeCompare(b.displayName),
        )
      : [];
  const editing = editor?.mode === "edit" ? rows.find((row) => row.id === editor.id) : undefined;
  const providerRows = providers.status === "ready" ? providers.data.items : [];

  const toggle = (model: ModelView) => {
    if (togglingId !== null) return;
    setTogglingId(model.id);
    reauth
      .run(() =>
        api(`/admin/ai/models/${model.id}`, {
          method: "PATCH",
          body: { enabled: !model.enabled },
          schema: modelViewSchema,
        }),
      )
      .then(
        () => {
          setTogglingId(null);
          toast({
            tone: "success",
            title: t(
              model.enabled ? "admin.ai.models.disabledToast" : "admin.ai.models.enabledToast",
              {
                name: model.displayName,
              },
            ),
          });
          resource.reload();
        },
        (error: unknown) => {
          setTogglingId(null);
          // `model_is_primary` reads "change the route first" through the shared reason messages.
          toast({ tone: "error", title: errorMessage(error) });
        },
      );
  };

  const columns: DataTableColumn<ModelView>[] = [
    {
      id: "model",
      header: t("admin.ai.models.col.model"),
      primary: true,
      cell: (model) => (
        <span className="flex flex-col items-start gap-1">
          <span>{model.displayName}</span>
          <Code>{model.modelId}</Code>
          <span className="text-sm font-normal text-text-muted">{model.provider.key}</span>
        </span>
      ),
    },
    {
      id: "caps",
      header: t("admin.ai.models.col.caps"),
      cell: (model) =>
        model.capabilities.length === 0 ? (
          "—"
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {model.capabilities.map((capability) => (
              <Badge key={capability} tone="info" className="py-0.5">
                {t(`admin.ai.cap.${capability}`)}
              </Badge>
            ))}
          </span>
        ),
    },
    {
      id: "prices",
      header: t("admin.ai.models.col.prices"),
      cell: (model) => (
        <span className="flex min-w-36 flex-col gap-0.5">
          <Price label={t("admin.ai.models.price.input")} micros={model.priceInputUsdMicrosPerM} />
          <Price
            label={t("admin.ai.models.price.cached")}
            micros={model.priceCachedInputUsdMicrosPerM}
          />
          <Price
            label={t("admin.ai.models.price.output")}
            micros={model.priceOutputUsdMicrosPerM}
          />
          <Price
            label={t("admin.ai.models.price.search")}
            micros={model.priceSearchUsdMicros > 0 ? model.priceSearchUsdMicros : null}
          />
        </span>
      ),
    },
    {
      id: "multiplier",
      header: t("admin.ai.models.col.multiplier"),
      cell: (model) => (
        <span dir="ltr" className="tabular-nums">
          {formatMultiplier(model.creditMultiplierBp)}
        </span>
      ),
    },
    {
      id: "status",
      header: t("admin.ai.models.col.status"),
      cell: (model) => (
        <span className="flex flex-wrap gap-1.5">
          <Badge tone={model.enabled ? "success" : "neutral"}>
            {t(model.enabled ? "admin.ai.on" : "admin.ai.off")}
          </Badge>
          {model.warnings.map((warning) => (
            <Badge key={warning} tone={WARNING_TONES[warning]}>
              {t(`admin.ai.models.warning.${warning}`)}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      id: "routes",
      header: t("admin.ai.models.col.routes"),
      cell: (model) => formatNumber(model.usedInRoutes),
    },
  ];

  const rowActions = canWrite
    ? (model: ModelView): RowAction[] => [
        {
          id: "edit",
          label: t("admin.ai.models.edit"),
          icon: Pencil,
          onSelect: () => {
            setEditor({ mode: "edit", id: model.id });
          },
        },
        {
          id: "toggle",
          label: t(model.enabled ? "admin.ai.models.disable" : "admin.ai.models.enable"),
          icon: Power,
          onSelect: () => {
            toggle(model);
          },
        },
        {
          id: "delete",
          label: t("admin.ai.models.delete"),
          icon: Trash2,
          tone: "danger",
          onSelect: () => {
            setRemoving(model);
          },
        },
      ]
    : undefined;

  const closeEditor = () => {
    setEditor(null);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="min-w-0 max-w-prose text-base text-text-muted">
          {canWrite ? t("admin.ai.models.lead") : t("admin.ai.models.readOnlyNote")}
        </p>
        {canWrite ? (
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              name="price-sync"
              onClick={() => {
                setSyncing(true);
              }}
            >
              <RefreshCw aria-hidden className="size-5" />
              {t("admin.ai.sync.button")}
            </Button>
            <Button
              name="new-model"
              onClick={() => {
                setEditor({ mode: "create" });
              }}
            >
              <Plus aria-hidden className="size-5" />
              {t("admin.ai.models.add")}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="max-w-sm">
        <Field label={t("admin.ai.models.filter.provider")}>
          {(control) => (
            <Select
              {...control}
              name="providerId"
              value={providerId}
              onChange={(event) => {
                setProviderId(event.target.value);
              }}
            >
              <option value="">{t("admin.ai.models.filter.all")}</option>
              {providerRows.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.key}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <DataTable
        caption={t("admin.nav.aiModels")}
        columns={columns}
        rows={rows}
        rowKey={(model) => model.id}
        status={resource.status}
        error={resource.status === "error" ? resource.error : undefined}
        onRetry={resource.reload}
        onOpenRow={
          canWrite
            ? (model) => {
                setEditor({ mode: "edit", id: model.id });
              }
            : undefined
        }
        openLabel={(model) => t("admin.ai.models.editTitle", { name: model.displayName })}
        rowActions={rowActions}
        actionsLabel={(model) => t("admin.table.actionsFor", { name: model.displayName })}
        filtersActive={providerId !== ""}
        onClearFilters={() => {
          setProviderId("");
        }}
        emptyTitle={t("admin.ai.models.empty")}
        emptyDescription={t("admin.ai.models.emptyBody")}
      />

      <Dialog
        open={editor?.mode === "create"}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
        title={t("admin.ai.models.addTitle")}
        className="sm:max-w-xl"
      >
        {/* Mounted only while open: every opening starts from an empty form and a fresh model list. */}
        {editor?.mode === "create" ? (
          <ModelForm
            model={null}
            providers={providerRows}
            defaultProviderId={providerId}
            onClose={closeEditor}
            onSaved={resource.reload}
          />
        ) : null}
      </Dialog>

      <DetailDrawer
        open={editing !== undefined}
        onClose={closeEditor}
        title={t("admin.ai.models.editTitle", { name: editing?.displayName ?? "" })}
      >
        {editing ? (
          <ModelForm
            key={`${editing.id}-${editing.updatedAt}`}
            model={editing}
            providers={providerRows}
            defaultProviderId=""
            onClose={closeEditor}
            onSaved={resource.reload}
          />
        ) : null}
      </DetailDrawer>

      <PriceSyncDialog
        open={syncing}
        onClose={() => {
          setSyncing(false);
        }}
        onApplied={resource.reload}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("admin.ai.models.deleteTitle", { name: removing?.displayName ?? "" })}
        description={t("admin.ai.models.deleteBody")}
        confirmLabel={t("admin.ai.models.delete")}
        tone="danger"
        onConfirm={async () => {
          if (!removing) return;
          await api(`/admin/ai/models/${removing.id}`, { method: "DELETE" });
          toast({
            tone: "success",
            title: t("admin.ai.models.deleted", { name: removing.displayName }),
          });
          resource.reload();
        }}
      />
    </div>
  );
}
