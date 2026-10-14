"use client";

import { t } from "@wasfa/shared/i18n";
import {
  modelListResponseSchema,
  routeViewSchema,
  ROUTE_MAX_MODELS,
  type ModelView,
  type RouteView,
} from "@wasfa/shared/schemas/admin-ai";
import {
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from "@wasfa/ui";
import { ArrowDown, ArrowUp, Plus, TriangleAlert, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { formatPricePair, isRxTask, modeLabel, taskLabel } from "../../lib/admin-billing";
import { api } from "../../lib/api-client";
import { ApiRequestError, errorReason } from "../../lib/api-error";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import {
  MEDIA_RESOLUTIONS,
  ROUTE_ITEM_REASONS,
  THINKING_LEVELS,
  draftFromRoute,
  emptyItem,
  moveItem,
  validateRoute,
  type RouteItemDraft,
} from "../../lib/route-draft";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { ConfirmDialog } from "./confirm-dialog";

import type { AiMode, AiTask } from "@wasfa/shared/ai";
import type { FormEvent } from "react";

export interface RouteEditorProps {
  task: AiTask;
  mode: AiMode;
  /** `null` edits the default route (every plan without its own). */
  planId: string | null;
  /** The stored route of exactly this task, plan and mode; `null` when there is none yet. */
  route: RouteView | null;
  /** The default route, copied as the starting point of a plan's override. */
  seed: RouteView | null;
  canWrite: boolean;
  /** The route was saved or removed: the grid reloads and the drawer closes. */
  onDone: () => void;
  /** Someone else saved first: reload the grid (the editor restarts from the new version). */
  onStale: () => void;
}

type Direction = "up" | "down";

const thinkingKey = {
  off: "admin.routes.thinking.off",
  minimal: "admin.routes.thinking.minimal",
  low: "admin.routes.thinking.low",
  medium: "admin.routes.thinking.medium",
  high: "admin.routes.thinking.high",
} as const;

const resolutionKey = {
  low: "admin.routes.resolution.low",
  medium: "admin.routes.resolution.medium",
  high: "admin.routes.resolution.high",
  ultra_high: "admin.routes.resolution.ultra_high",
} as const;

const warningKey = {
  model_missing: "admin.routes.warning.model_missing",
  model_disabled: "admin.routes.warning.model_disabled",
  provider_disabled: "admin.routes.warning.provider_disabled",
} as const;

interface ItemProps {
  item: RouteItemDraft;
  index: number;
  total: number;
  rx: boolean;
  readOnly: boolean;
  models: readonly ModelView[];
  /** Models already used by the other items of this route (a model appears once). */
  usedElsewhere: ReadonlySet<string>;
  error: string | undefined;
  warnings: readonly (keyof typeof warningKey)[];
  idBase: string;
  onChange: (patch: Partial<RouteItemDraft>) => void;
  onMove: (direction: Direction) => void;
  onRemove: () => void;
}

function RouteItem({
  item,
  index,
  total,
  rx,
  readOnly,
  models,
  usedElsewhere,
  error,
  warnings,
  idBase,
  onChange,
  onMove,
  onRemove,
}: ItemProps) {
  const label = index === 0 ? t("admin.routes.primary") : t("admin.routes.fallback", { n: index });
  const selected = models.find((model) => model.id === item.modelId);
  const groups = new Map<string, ModelView[]>();
  for (const model of models) {
    const list = groups.get(model.provider.key) ?? [];
    list.push(model);
    groups.set(model.provider.key, list);
  }

  const control = (direction: Direction) => {
    const Icon = direction === "up" ? ArrowUp : ArrowDown;
    const disabled = readOnly || (direction === "up" ? index === 0 : index === total - 1);
    return (
      <button
        type="button"
        id={`${idBase}-${item.key}-${direction}`}
        disabled={disabled}
        onClick={() => {
          onMove(direction);
        }}
        aria-label={t(direction === "up" ? "admin.routes.moveUp" : "admin.routes.moveDown")}
        className="inline-flex size-11 items-center justify-center rounded-lg text-neutral-600 transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-40"
      >
        <Icon aria-hidden className="size-5" />
      </button>
    );
  };

  return (
    <li>
      <fieldset
        aria-label={label}
        className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={index === 0 ? "info" : "neutral"}>{label}</Badge>
            {warnings.map((warning) => (
              <Badge key={warning} tone="warning">
                <TriangleAlert aria-hidden className="size-4" />
                {t(warningKey[warning])}
              </Badge>
            ))}
          </div>
          {readOnly ? null : (
            <div className="flex items-center">
              {control("up")}
              {control("down")}
              <button
                type="button"
                disabled={total === 1}
                onClick={onRemove}
                aria-label={t("admin.routes.remove")}
                className="inline-flex size-11 items-center justify-center rounded-lg text-danger transition-colors duration-150 hover:bg-danger-soft focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-40"
              >
                <Trash2 aria-hidden className="size-5" />
              </button>
            </div>
          )}
        </div>

        <Field label={t("admin.routes.model")} error={error} announceError={error !== undefined}>
          {(field) => (
            <Select
              {...field}
              name={`model-${String(index)}`}
              value={item.modelId}
              disabled={readOnly}
              onChange={(event) => {
                onChange({ modelId: event.target.value });
              }}
            >
              <option value="">{t("admin.routes.pickModel")}</option>
              {item.modelId !== "" && !selected ? (
                <option value={item.modelId}>{t("admin.routes.modelMissing")}</option>
              ) : null}
              {[...groups.entries()].map(([providerKey, list]) => (
                <optgroup key={providerKey} label={providerKey}>
                  {list.map((model) => (
                    <option
                      key={model.id}
                      value={model.id}
                      disabled={usedElsewhere.has(model.id) && model.id !== item.modelId}
                    >
                      {model.enabled
                        ? model.displayName
                        : `${model.displayName} (${t("admin.routes.disabledSuffix")})`}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          )}
        </Field>
        {selected ? (
          <p className="text-sm text-text-muted">
            <span dir="ltr" className="tabular-nums">
              {formatPricePair(selected.priceInputUsdMicrosPerM, selected.priceOutputUsdMicrosPerM)}
            </span>{" "}
            {t("admin.routes.pricePer1m")}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("admin.routes.thinking")}>
            {(field) => (
              <Select
                {...field}
                name={`thinking-${String(index)}`}
                value={item.thinking}
                disabled={readOnly}
                onChange={(event) => {
                  onChange({ thinking: event.target.value });
                }}
              >
                <option value="">{t("admin.routes.thinking.default")}</option>
                {THINKING_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t(thinkingKey[level])}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {rx ? (
            <Field label={t("admin.routes.mediaResolution")}>
              {(field) => (
                <Select
                  {...field}
                  name={`mediaResolution-${String(index)}`}
                  value={item.mediaResolution}
                  disabled={readOnly}
                  onChange={(event) => {
                    onChange({ mediaResolution: event.target.value });
                  }}
                >
                  <option value="">{t("admin.routes.thinking.default")}</option>
                  {MEDIA_RESOLUTIONS.map((level) => (
                    <option key={level} value={level}>
                      {t(resolutionKey[level])}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label={t("admin.routes.temperature")} hint={t("admin.routes.temperatureHint")}>
            {(field) => (
              <Input
                {...field}
                name={`temperature-${String(index)}`}
                type="number"
                step="0.1"
                min={0}
                max={2}
                ltr
                value={item.temperature}
                disabled={readOnly}
                onChange={(event) => {
                  onChange({ temperature: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label={t("admin.routes.maxOutputTokens")}>
            {(field) => (
              <Input
                {...field}
                name={`maxOutputTokens-${String(index)}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={65536}
                ltr
                value={item.maxOutputTokens}
                disabled={readOnly}
                onChange={(event) => {
                  onChange({ maxOutputTokens: event.target.value });
                }}
              />
            )}
          </Field>
        </div>
        <div className="flex flex-wrap gap-x-6">
          <Checkbox
            name={`search-${String(index)}`}
            label={t("admin.routes.search")}
            checked={item.search}
            disabled={readOnly}
            onChange={(event) => {
              onChange({ search: event.target.checked });
            }}
          />
          <Checkbox
            name={`jsonSchema-${String(index)}`}
            label={t("admin.routes.jsonSchema")}
            checked={item.jsonSchema}
            disabled={readOnly}
            onChange={(event) => {
              onChange({ jsonSchema: event.target.checked });
            }}
          />
        </div>
      </fieldset>
    </li>
  );
}

/**
 * The route editor (Decision 1): an ordered list, index 0 the primary and the rest fallbacks in
 * order. The list is reordered with buttons (keyboard friendly) and each move is announced. Saving
 * sends the version that was loaded; the API refuses it when someone else saved first.
 */
export function RouteEditor({
  task,
  mode,
  planId,
  route,
  seed,
  canWrite,
  onDone,
  onStale,
}: RouteEditorProps) {
  const reauth = useReauth();
  const { toast } = useToast();
  const idBase = useId();
  const modelsResource = useResource("/admin/ai/models", modelListResponseSchema);
  const rx = isRxTask(task);

  const [items, setItems] = useState<RouteItemDraft[]>(() =>
    draftFromRoute((route ?? seed)?.models ?? []),
  );
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [listError, setListError] = useState<string | null>(null);
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Asked for by the API when the new primary scored lower than the current one in the accuracy eval.
  const [needReason, setNeedReason] = useState(false);
  const [reason, setReason] = useState("");
  const [removing, setRemoving] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ key: string; direction: Direction } | null>(
    null,
  );

  const models = useMemo(
    () => (modelsResource.status === "ready" ? modelsResource.data.items : []),
    [modelsResource],
  );
  const modelById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models]);

  // The warnings of the stored route follow the model, not the position, so a move keeps them.
  const warningsByModel = useMemo(() => {
    const byModel = new Map<string, (keyof typeof warningKey)[]>();
    for (const warning of route?.warnings ?? []) {
      const modelId = route?.models[warning.index]?.modelId;
      if (modelId === undefined) continue;
      byModel.set(modelId, [...(byModel.get(modelId) ?? []), warning.reason]);
    }
    return byModel;
  }, [route]);

  // After a move the same button keeps focus; at the edge it is disabled, so the other one takes it.
  useEffect(() => {
    if (!focusRequest) return;
    const pick = (direction: Direction) =>
      document.getElementById(`${idBase}-${focusRequest.key}-${direction}`);
    const preferred = pick(focusRequest.direction);
    const other = pick(focusRequest.direction === "up" ? "down" : "up");
    const target =
      preferred instanceof HTMLButtonElement && !preferred.disabled ? preferred : other;
    if (target instanceof HTMLButtonElement && !target.disabled) target.focus();
    setFocusRequest(null);
  }, [focusRequest, idBase]);

  const nameOf = (item: RouteItemDraft) =>
    modelById.get(item.modelId)?.displayName ?? t("admin.routes.pickModel");

  const patchItem = (key: string, patch: Partial<RouteItemDraft>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
    setItemErrors((current) => {
      if (!Object.hasOwn(current, key)) return current;
      return Object.fromEntries(Object.entries(current).filter(([name]) => name !== key));
    });
  };

  const move = (index: number, direction: Direction) => {
    const target = direction === "up" ? index - 1 : index + 1;
    const item = items[index];
    if (!item || target < 0 || target >= items.length) return;
    setItems(moveItem(items, index, target));
    setAnnouncement(
      t("admin.routes.moved", { name: nameOf(item), position: target + 1, total: items.length }),
    );
    setFocusRequest({ key: item.key, direction });
  };

  const removeItem = (key: string) => {
    setItems((current) =>
      current.length > 1 ? current.filter((item) => item.key !== key) : current,
    );
    setAnnouncement(t("admin.routes.removed"));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !canWrite) return;
    const checked = validateRoute(items, rx);
    if (!checked.models) {
      setItemErrors(checked.itemErrors);
      setListError(checked.listError);
      setFormError(null);
      return;
    }
    setSubmitting(true);
    setItemErrors({});
    setListError(null);
    setFormError(null);
    const body = {
      task,
      planId,
      mode,
      models: checked.models,
      ...(route ? { expectedVersion: route.version } : {}),
      ...(reason.trim() === "" ? {} : { reason: reason.trim() }),
    };
    reauth
      .run(() => api("/admin/ai/routes", { method: "PUT", body, schema: routeViewSchema }))
      .then(
        () => {
          toast({ tone: "success", title: t("admin.routes.saved") });
          onDone();
        },
        (error: unknown) => {
          setSubmitting(false);
          if (errorReason(error) === "stale_version") {
            toast({ tone: "info", title: t("admin.routes.stale") });
            onStale();
            return;
          }
          if (errorReason(error) === "eval_regression_reason_required") {
            setNeedReason(true);
            setFormError(null);
            return;
          }
          const index = error instanceof ApiRequestError ? error.details?.["index"] : undefined;
          const offending = typeof index === "number" ? items[index] : undefined;
          if (offending) {
            const reason = errorReason(error);
            const key = reason ? ROUTE_ITEM_REASONS[reason] : undefined;
            setItemErrors({ [offending.key]: key ? t(key) : t("form.invalid") });
            return;
          }
          setFormError(toApiError(error));
        },
      );
  };

  const removeOverride = async (): Promise<void> => {
    if (!route) return;
    await api(`/admin/ai/routes/${route.id}`, { method: "DELETE" });
    toast({ tone: "success", title: t("admin.routes.overrideRemoved") });
    onDone();
  };

  if (modelsResource.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <p className="sr-only" role="status">
          {t("ui.loading")}
        </p>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (modelsResource.status === "error") {
    return <ErrorNotice error={modelsResource.error} onRetry={modelsResource.reload} />;
  }

  const readOnly = !canWrite;
  const used = new Set(items.map((item) => item.modelId).filter((id) => id !== ""));

  return (
    <>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <p className="text-base text-text-muted">
          {t("admin.routes.editorLead")}{" "}
          {route
            ? t("admin.routes.version", { version: route.version })
            : seed && planId !== null
              ? t("admin.routes.startsFromDefault")
              : t("admin.routes.notSaved")}
        </p>

        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>

        <ol className="flex flex-col gap-4">
          {items.map((item, index) => (
            <RouteItem
              key={item.key}
              item={item}
              index={index}
              total={items.length}
              rx={rx}
              readOnly={readOnly}
              models={models}
              usedElsewhere={used}
              error={itemErrors[item.key]}
              warnings={warningsByModel.get(item.modelId) ?? []}
              idBase={idBase}
              onChange={(patch) => {
                patchItem(item.key, patch);
              }}
              onMove={(direction) => {
                move(index, direction);
              }}
              onRemove={() => {
                removeItem(item.key);
              }}
            />
          ))}
        </ol>

        {listError ? (
          <p role="alert" className="text-sm text-danger">
            {listError}
          </p>
        ) : null}

        {readOnly ? null : (
          <div>
            <Button
              variant="secondary"
              name="add-fallback"
              disabled={items.length >= ROUTE_MAX_MODELS}
              onClick={() => {
                setItems((current) => [...current, emptyItem()]);
              }}
            >
              <Plus aria-hidden className="size-5" />
              {t("admin.routes.addFallback")}
            </Button>
            {items.length >= ROUTE_MAX_MODELS ? (
              <p className="mt-2 text-sm text-text-muted">
                {t("admin.routes.maxModels", { max: ROUTE_MAX_MODELS })}
              </p>
            ) : null}
          </div>
        )}

        {needReason ? (
          <Field
            label={t("admin.evals.promotion.reason")}
            hint={t("admin.evals.promotion.hint")}
            required
          >
            {(control) => (
              <Textarea
                {...control}
                name="reason"
                value={reason}
                maxLength={500}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
            )}
          </Field>
        ) : null}

        {formError ? <ErrorNotice error={formError} /> : null}

        {readOnly ? null : (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            {planId !== null && route ? (
              <Button
                variant="ghost"
                name="remove-override"
                className="text-danger hover:bg-danger-soft"
                onClick={() => {
                  setRemoving(true);
                }}
              >
                <Trash2 aria-hidden className="size-5" />
                {t("admin.routes.removeOverride")}
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" name="save" loading={submitting}>
              {t("common.save")}
            </Button>
          </div>
        )}
      </form>

      {/* Outside the form: a dialog's own form cannot nest inside this one. */}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t("admin.routes.removeOverrideTitle", {
          task: taskLabel(task),
          mode: modeLabel(mode),
        })}
        description={t("admin.routes.removeOverrideBody")}
        confirmLabel={t("admin.routes.removeOverride")}
        tone="danger"
        onConfirm={removeOverride}
      />
    </>
  );
}
