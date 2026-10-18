"use client";

import { t } from "@wasfa/shared/i18n";
import { Badge, Button, Card, CardTitle, moneyText } from "@wasfa/ui";
import { CreditCard, Landmark, Pencil } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  methodListSchema,
  taxRuleListSchema,
  type MethodView,
} from "../../lib/admin-billing-schemas";
import { percentText } from "../../lib/admin-revenue";
import { useResource } from "../../lib/use-admin-data";

import { AccountChangePanel } from "./account-change-panel";
import { CheckoutRulesPreview } from "./checkout-rules-preview";
import { MethodEditorDialog } from "./method-editor-dialog";
import { ResourceBoundary } from "./resource-boundary";
import { TaxRulesPanel } from "./tax-rules-panel";

function MethodCard({
  method,
  canWrite,
  onEdit,
}: {
  method: MethodView;
  canWrite: boolean;
  onEdit: () => void;
}) {
  const manual = method.kind === "manual";
  return (
    <Card elevation="flat" className="flex flex-col gap-4" data-testid="method-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="flex items-center gap-2 font-heading text-lg font-semibold">
          {manual ? (
            <Landmark aria-hidden className="size-5" />
          ) : (
            <CreditCard aria-hidden className="size-5" />
          )}
          {method.nameAr}
        </h3>
        <span className="flex flex-wrap gap-2">
          <Badge tone={method.enabled ? "success" : "neutral"}>
            {method.enabled ? t("admin.pricing.method.on") : t("admin.pricing.method.off")}
          </Badge>
          {method.gateway ? (
            <Badge tone={method.gateway.verified ? "success" : "warning"}>
              {method.gateway.verified
                ? t("admin.pricing.method.gatewayVerified")
                : t("admin.pricing.method.gatewayUnverified")}
            </Badge>
          ) : null}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-text-muted">{t("admin.pricing.method.fee")}</dt>
          <dd className="tabular-nums">
            {percentText(method.feeBps)}
            {method.feeFixedMinor > 0
              ? ` + ${moneyText(method.feeFixedMinor, method.currencies[0] ?? "EGP")}`
              : ""}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">{t("admin.pricing.method.currencies")}</dt>
          <dd>
            <bdi dir="ltr">{method.currencies.join(", ")}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">{t("admin.pricing.method.proof")}</dt>
          <dd>{method.requiresProof ? t("admin.revenue.yes") : t("admin.revenue.no")}</dd>
        </div>
        <div>
          <dt className="text-text-muted">{t("admin.pricing.method.sla")}</dt>
          <dd className="tabular-nums">
            {method.reviewSlaMinutes === null
              ? "—"
              : t("admin.pricing.method.slaMinutes", { minutes: method.reviewSlaMinutes })}
          </dd>
        </div>
      </dl>
      {canWrite ? (
        <Button
          variant="secondary"
          name={`edit-${method.key}`}
          className="self-start"
          onClick={onEdit}
        >
          <Pencil aria-hidden className="size-5" />
          {t("admin.pricing.method.edit")}
        </Button>
      ) : null}
      {manual ? (
        <section
          aria-label={t("admin.pricing.account.title")}
          className="flex flex-col gap-3 border-t border-border pt-4"
        >
          <h4 className="font-heading text-base font-semibold">
            {t("admin.pricing.account.title")}
          </h4>
          <p className="text-base">
            {t("admin.pricing.account.current")}{" "}
            <bdi dir="ltr" className="font-mono">
              {method.accountDisplay ?? "—"}
            </bdi>
          </p>
          <AccountChangePanel methodKey={method.key} canWrite={canWrite} />
        </section>
      ) : (
        <Link
          href="/admin/billing/gateways"
          className="inline-flex min-h-11 items-center self-start rounded-lg px-3 text-base font-semibold text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
        >
          {t("admin.pricing.method.gatewayLink")}
        </Link>
      )}
    </Card>
  );
}

/** `/admin/billing/methods`: payment method cards, protected account numbers, tax rules and the checkout preview. */
export function BillingMethodsView({ canWrite }: { canWrite: boolean }) {
  const methods = useResource("/admin/billing/methods", methodListSchema);
  const rules = useResource("/admin/billing/tax-rules", taxRuleListSchema);
  const [editing, setEditing] = useState<MethodView | null>(null);
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="methods-title" className="flex flex-col gap-4">
        <h2 id="methods-title" className="font-heading text-xl font-semibold">
          {t("admin.pricing.method.title")}
        </h2>
        <ResourceBoundary resource={methods}>
          {(data) => (
            <div className="grid gap-4 lg:grid-cols-2">
              {data.items.map((method) => (
                <MethodCard
                  key={method.key}
                  method={method}
                  canWrite={canWrite}
                  onEdit={() => {
                    setEditing(method);
                  }}
                />
              ))}
            </div>
          )}
        </ResourceBoundary>
      </section>
      <section aria-labelledby="tax-title" className="flex flex-col gap-4">
        <h2 id="tax-title" className="font-heading text-xl font-semibold">
          {t("admin.pricing.tax.title")}
        </h2>
        <TaxRulesPanel canWrite={canWrite} />
      </section>
      <Card elevation="flat" className="flex flex-col gap-3">
        <CardTitle>{t("admin.pricing.checkoutPreview.title")}</CardTitle>
        {methods.status === "ready" && rules.status === "ready" ? (
          <CheckoutRulesPreview methods={methods.data.items} rules={rules.data} />
        ) : (
          <p className="text-base text-text-muted">{t("ui.loading")}</p>
        )}
      </Card>
      {editing ? (
        <MethodEditorDialog
          key={editing.key}
          method={editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSaved={methods.reload}
        />
      ) : null}
    </div>
  );
}
