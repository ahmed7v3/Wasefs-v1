"use client";

import { t } from "@wasfa/shared/i18n";
import { planListResponseSchema, planViewSchema, type PlanView } from "@wasfa/shared/schemas/plans";
import { Badge, Button, Tab, TabList, TabPanel, Tabs, useToast } from "@wasfa/ui";
import { Pencil, Plus, SlidersHorizontal, Star, Trash2 } from "lucide-react";
import { useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { useResource } from "../../lib/use-admin-data";

import { AssignmentsPanel } from "./assignments-panel";
import { Code } from "./badges";
import { ConfirmDialog } from "./confirm-dialog";
import { DataTable, type DataTableColumn, type RowAction } from "./data-table";
import { DetailDrawer } from "./drawer";
import { EntitlementsEditor } from "./entitlements-editor";
import { PlanDialog, planAudienceLabel, planVisibilityLabel } from "./plan-dialog";

export interface PlansViewProps {
  /** `plans.write`: create, edit, delete, entitlements and assignments. */
  canWrite: boolean;
  /** `users.read`: the assign dialog can search users by name or email. */
  canSearchUsers: boolean;
}

type Editor = { plan: PlanView | null };

export function PlansView({ canWrite, canSearchUsers }: PlansViewProps) {
  const resource = useResource("/admin/plans", planListResponseSchema);
  const { toast } = useToast();
  const [tab, setTab] = useState("plans");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [entitlementsFor, setEntitlementsFor] = useState<string | null>(null);
  const [makingDefault, setMakingDefault] = useState<PlanView | null>(null);
  const [removing, setRemoving] = useState<PlanView | null>(null);

  const rows = resource.status === "ready" ? resource.data.items : [];
  const entitlementsPlan = rows.find((plan) => plan.id === entitlementsFor) ?? null;

  const columns: DataTableColumn<PlanView>[] = [
    {
      id: "name",
      header: t("admin.plans.col.name"),
      primary: true,
      cell: (plan) => (
        <span className="flex flex-col">
          <span className="flex flex-wrap items-center gap-2">
            {plan.nameAr}
            {plan.isDefault ? <Badge tone="success">{t("admin.plans.default")}</Badge> : null}
          </span>
          <span className="text-sm font-normal text-text-muted" dir="ltr">
            {plan.nameEn}
          </span>
        </span>
      ),
    },
    { id: "key", header: t("admin.plans.col.key"), cell: (plan) => <Code>{plan.key}</Code> },
    {
      id: "audience",
      header: t("admin.plans.col.audience"),
      cell: (plan) => planAudienceLabel(plan.audience),
    },
    {
      id: "visibility",
      header: t("admin.plans.col.visibility"),
      cell: (plan) => (
        <Badge tone={plan.visibility === "public" ? "info" : "neutral"}>
          {planVisibilityLabel(plan.visibility)}
        </Badge>
      ),
    },
    {
      id: "credits",
      header: t("admin.plans.col.credits"),
      cell: (plan) => (
        <span dir="ltr" className="tabular-nums">
          {formatNumber(plan.monthlyCredits)}
        </span>
      ),
    },
    {
      id: "sort",
      header: t("admin.plans.col.sort"),
      cell: (plan) => (
        <span dir="ltr" className="tabular-nums">
          {formatNumber(plan.sort)}
        </span>
      ),
    },
    {
      id: "badge",
      header: t("admin.plans.col.badge"),
      cell: (plan) => plan.badgeAr ?? "—",
    },
  ];

  const rowActions = (plan: PlanView): RowAction[] => {
    const actions: RowAction[] = [
      {
        id: "entitlements",
        label: t("admin.plans.entitlements"),
        icon: SlidersHorizontal,
        onSelect: () => {
          setEntitlementsFor(plan.id);
        },
      },
    ];
    if (!canWrite) return actions;
    actions.push({
      id: "edit",
      label: t("admin.plans.edit"),
      icon: Pencil,
      onSelect: () => {
        setEditor({ plan });
      },
    });
    if (!plan.isDefault) {
      actions.push(
        {
          id: "make-default",
          label: t("admin.plans.makeDefault"),
          icon: Star,
          onSelect: () => {
            setMakingDefault(plan);
          },
        },
        {
          id: "delete",
          label: t("admin.plans.delete"),
          icon: Trash2,
          tone: "danger",
          onSelect: () => {
            setRemoving(plan);
          },
        },
      );
    }
    return actions;
  };

  const makeDefault = async (): Promise<void> => {
    if (!makingDefault) return;
    await api(`/admin/plans/${makingDefault.id}`, {
      method: "PATCH",
      body: { isDefault: true },
      schema: planViewSchema,
    });
    toast({ tone: "success", title: t("admin.plans.madeDefault", { name: makingDefault.nameAr }) });
    resource.reload();
  };

  const remove = async (): Promise<void> => {
    if (!removing) return;
    await api(`/admin/plans/${removing.id}`, { method: "DELETE" });
    toast({ tone: "success", title: t("admin.plans.deleted", { name: removing.nameAr }) });
    resource.reload();
  };

  return (
    <div className="flex flex-col gap-5">
      <Tabs value={tab} onValueChange={setTab}>
        <TabList aria-label={t("admin.plans.title")}>
          <Tab value="plans">{t("admin.plans.tab.plans")}</Tab>
          <Tab value="assignments">{t("admin.plans.tab.assignments")}</Tab>
        </TabList>

        <TabPanel value="plans" className="flex flex-col gap-5">
          {canWrite ? (
            <div className="flex justify-end">
              <Button
                name="new-plan"
                onClick={() => {
                  setEditor({ plan: null });
                }}
              >
                <Plus aria-hidden className="size-5" />
                {t("admin.plans.create")}
              </Button>
            </div>
          ) : (
            <p className="text-base text-text-muted">{t("admin.plans.readOnlyNote")}</p>
          )}
          <DataTable
            caption={t("admin.plans.tab.plans")}
            columns={columns}
            rows={rows}
            rowKey={(plan) => plan.id}
            status={resource.status}
            error={resource.status === "error" ? resource.error : undefined}
            onRetry={resource.reload}
            onOpenRow={(plan) => {
              setEntitlementsFor(plan.id);
            }}
            openLabel={(plan) => t("admin.plans.openEntitlements", { name: plan.nameAr })}
            rowActions={rowActions}
            actionsLabel={(plan) => t("admin.table.actionsFor", { name: plan.nameAr })}
            emptyTitle={t("admin.plans.empty")}
          />
        </TabPanel>

        <TabPanel value="assignments">
          {tab === "assignments" ? (
            <AssignmentsPanel plans={rows} canWrite={canWrite} canSearchUsers={canSearchUsers} />
          ) : null}
        </TabPanel>
      </Tabs>

      <PlanDialog
        open={editor !== null}
        plan={editor?.plan ?? null}
        onClose={() => {
          setEditor(null);
        }}
        onSaved={resource.reload}
      />

      <DetailDrawer
        open={entitlementsPlan !== null}
        onClose={() => {
          setEntitlementsFor(null);
        }}
        title={t("admin.plans.entitlementsTitle", { name: entitlementsPlan?.nameAr ?? "" })}
      >
        {entitlementsPlan ? (
          <EntitlementsEditor
            key={`${entitlementsPlan.id}:${entitlementsPlan.updatedAt}`}
            plan={entitlementsPlan}
            canWrite={canWrite}
            onSaved={() => {
              resource.reload();
              setEntitlementsFor(null);
            }}
          />
        ) : null}
      </DetailDrawer>

      <ConfirmDialog
        open={makingDefault !== null}
        onOpenChange={(open) => {
          if (!open) setMakingDefault(null);
        }}
        title={t("admin.plans.makeDefaultTitle", { name: makingDefault?.nameAr ?? "" })}
        description={t("admin.plans.makeDefaultBody")}
        confirmLabel={t("admin.plans.makeDefault")}
        onConfirm={makeDefault}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("admin.plans.deleteTitle", { name: removing?.nameAr ?? "" })}
        description={t("admin.plans.deleteBody")}
        confirmLabel={t("admin.plans.delete")}
        tone="danger"
        onConfirm={remove}
      />
    </div>
  );
}
