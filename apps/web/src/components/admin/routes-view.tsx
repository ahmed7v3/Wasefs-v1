"use client";

import { AI_MODES, AI_TASKS, type AiMode, type AiTask } from "@wasfa/shared/ai";
import { t } from "@wasfa/shared/i18n";
import { routeListResponseSchema, type RouteView } from "@wasfa/shared/schemas/admin-ai";
import { planListResponseSchema } from "@wasfa/shared/schemas/plans";
import { Badge, Button, Card, Field, Select, Skeleton } from "@wasfa/ui";
import { Pencil, Plus, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { modeLabel, taskLabel } from "../../lib/admin-billing";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { DetailDrawer } from "./drawer";
import { RouteEditor } from "./route-editor";

export interface RoutesViewProps {
  /** `ai.write`: edit and remove routes. */
  canWrite: boolean;
  /** `plans.read`: the plan selector lists the plans (otherwise only the default routes show). */
  canReadPlans: boolean;
}

interface Scope {
  task: AiTask;
  mode: AiMode;
}

const scopeKey = (task: AiTask, mode: AiMode) => `${task}/${mode}`;

interface CellProps {
  task: AiTask;
  mode: AiMode;
  route: RouteView | undefined;
  /** The default route a plan without its own inherits; `undefined` when showing the default itself. */
  inherited: RouteView | null | undefined;
  canWrite: boolean;
  onOpen: () => void;
}

function primaryName(route: RouteView): string {
  return route.models[0]?.model?.displayName ?? t("admin.routes.modelMissing");
}

function RouteCell({ task, mode, route, inherited, canWrite, onOpen }: CellProps) {
  const where = t("admin.routes.cell.where", { task: taskLabel(task), mode: modeLabel(mode) });

  if (route) {
    const fallbacks = route.models.length - 1;
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${where}: ${primaryName(route)}`}
        className="flex w-full min-w-44 flex-col items-start gap-1 rounded-lg border border-border bg-surface p-3 text-start transition-colors duration-150 hover:bg-primary-soft/50 focus-visible:outline-none focus-visible:shadow-focus"
      >
        <span className="font-semibold text-text">{primaryName(route)}</span>
        <span className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
          <span>
            {fallbacks === 0
              ? t("admin.routes.noFallbacks")
              : t("admin.routes.fallbacks", { count: fallbacks })}
          </span>
          <span dir="ltr" className="tabular-nums">
            v{route.version}
          </span>
          {route.warnings.length > 0 ? (
            <Badge tone="warning" className="py-0.5">
              <TriangleAlert aria-hidden className="size-4" />
              {t("admin.routes.warnings", { count: route.warnings.length })}
            </Badge>
          ) : null}
        </span>
      </button>
    );
  }

  // A plan without its own route uses the default one: say so, and offer to override it.
  if (inherited !== undefined) {
    return (
      <div className="flex min-w-44 flex-col items-start gap-2 rounded-lg border border-dashed border-border p-3">
        <span className="text-sm text-text-muted">
          {t("admin.routes.inherits")}
          {inherited ? `: ${primaryName(inherited)}` : ""}
        </span>
        {canWrite ? (
          <Button
            variant="secondary"
            onClick={onOpen}
            aria-label={`${where}: ${t("admin.routes.override")}`}
          >
            <Pencil aria-hidden className="size-4" />
            {t("admin.routes.override")}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-w-44 flex-col items-start gap-2 rounded-lg border border-dashed border-warning p-3">
      <span className="flex items-center gap-1 text-sm text-warning">
        <TriangleAlert aria-hidden className="size-4" />
        {t("admin.routes.notConfigured")}
      </span>
      {canWrite ? (
        <Button
          variant="secondary"
          onClick={onOpen}
          aria-label={`${where}: ${t("admin.routes.setup")}`}
        >
          <Plus aria-hidden className="size-4" />
          {t("admin.routes.setup")}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The route grid (Decision 1): rows are tasks, columns are modes. A plan's cells show its own route,
 * or "inherits the default" with a button to override it. A cell opens the editor in a drawer.
 */
export function RoutesView({ canWrite, canReadPlans }: RoutesViewProps) {
  const routes = useResource("/admin/ai/routes", routeListResponseSchema);
  const plans = useResource(canReadPlans ? "/admin/plans" : null, planListResponseSchema);
  const [planId, setPlanId] = useState("");
  const [editing, setEditing] = useState<Scope | null>(null);

  if (routes.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <p className="sr-only" role="status">
          {t("ui.loading")}
        </p>
        <Skeleton className="h-11 w-64" />
        <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </Card>
      </div>
    );
  }
  if (routes.status === "error") {
    return <ErrorNotice error={routes.error} onRetry={routes.reload} />;
  }

  const planList = canReadPlans && plans.status === "ready" ? plans.data.items : [];
  const selectedPlan = planList.find((plan) => plan.id === planId);
  const scopePlanId = selectedPlan ? selectedPlan.id : null;

  const routeMap = (forPlan: string | null) =>
    new Map(
      routes.data.items
        .filter((route) => route.planId === forPlan)
        .map((route) => [scopeKey(route.task, route.mode), route]),
    );
  const own = routeMap(scopePlanId);
  const defaults = routeMap(null);

  const editingRoute = editing ? (own.get(scopeKey(editing.task, editing.mode)) ?? null) : null;
  const editingSeed = editing ? (defaults.get(scopeKey(editing.task, editing.mode)) ?? null) : null;
  const close = () => {
    setEditing(null);
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-base text-text-muted">
        {canWrite ? t("admin.routes.lead") : t("admin.routes.readOnlyNote")}
      </p>

      <div className="flex max-w-md flex-col gap-2">
        <Field
          label={t("admin.routes.plan")}
          hint={
            canReadPlans && plans.status === "error" ? t("admin.routes.plansFailed") : undefined
          }
        >
          {(control) => (
            <Select
              {...control}
              name="plan"
              value={selectedPlan ? selectedPlan.id : ""}
              onChange={(event) => {
                setPlanId(event.target.value);
              }}
            >
              <option value="">{t("admin.routes.defaultPlan")}</option>
              {planList.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.nameAr} ({plan.key})
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Card elevation="flat" padding="none" className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-start text-base">
          <caption className="sr-only">
            {selectedPlan
              ? t("admin.routes.captionPlan", { plan: selectedPlan.nameAr })
              : t("admin.routes.captionDefault")}
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="h-12 border-b border-border bg-neutral-50 px-4 text-start text-sm font-semibold text-text-muted"
              >
                {t("admin.routes.col.task")}
              </th>
              {AI_MODES.map((mode) => (
                <th
                  key={mode}
                  scope="col"
                  className="h-12 border-b border-border bg-neutral-50 px-4 text-start text-sm font-semibold text-text-muted"
                >
                  {modeLabel(mode)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AI_TASKS.map((task) => (
              <tr key={task}>
                <th
                  scope="row"
                  className="border-b border-border px-4 py-3 text-start align-top font-semibold"
                >
                  {taskLabel(task)}
                </th>
                {AI_MODES.map((mode) => (
                  <td key={mode} className="border-b border-border p-3 align-top">
                    <RouteCell
                      task={task}
                      mode={mode}
                      route={own.get(scopeKey(task, mode))}
                      inherited={
                        scopePlanId === null
                          ? undefined
                          : (defaults.get(scopeKey(task, mode)) ?? null)
                      }
                      canWrite={canWrite}
                      onOpen={() => {
                        setEditing({ task, mode });
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <DetailDrawer
        open={editing !== null}
        onClose={close}
        title={
          editing
            ? `${taskLabel(editing.task)} · ${modeLabel(editing.mode)}${
                selectedPlan ? ` · ${selectedPlan.nameAr}` : ""
              }`
            : t("admin.routes.editorTitle")
        }
      >
        {editing ? (
          <RouteEditor
            // A new stored version (a save elsewhere, then a reload) restarts the editor from it.
            key={`${editingRoute?.id ?? "new"}:${String(editingRoute?.version ?? 0)}`}
            task={editing.task}
            mode={editing.mode}
            planId={scopePlanId}
            route={editingRoute}
            seed={editingSeed}
            canWrite={canWrite}
            onDone={() => {
              routes.reload();
              close();
            }}
            onStale={routes.reload}
          />
        ) : null}
      </DetailDrawer>
    </div>
  );
}
