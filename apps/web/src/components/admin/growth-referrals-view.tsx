"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { renderRuleSentence } from "@wasfa/shared/reward-sentence";
import { REWARD_EVENTS, REWARD_KINDS, REWARD_BENEFICIARIES, REWARD_REDEEMABLE_AS } from "@wasfa/shared/rewards";
import {
  codeListSchema,
  codeViewSchema,
  programViewSchema,
  referralTreeSchema,
  rewardsPreviewSchema,
  ruleListSchema,
  tierListSchema,
  whatIfResultSchema,
  type CodeView,
  type WhatIfResult,
} from "@wasfa/shared/schemas/admin-growth";
import { Button, Card, Dialog, Field, Input, Select, Tab, TabList, TabPanel, Tabs, moneyText, useToast } from "@wasfa/ui";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { formatNumber, tOr } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { useCursorList, useResource } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";
import { ErrorNotice } from "../error-notice";

import { ReasonDialog } from "./reason-dialog";
import { ResourceBoundary } from "./resource-boundary";
import { StatusChip } from "./status-chip";
import { UserPicker, type PickedUser } from "./user-picker";

const programsSchema = z.object({ items: z.array(programViewSchema) });

function ProgramPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const programs = useResource("/admin/growth/programs", programsSchema);
  const items = useMemo(() => (programs.status === "ready" ? programs.data.items : []), [programs]);
  useEffect(() => {
    if (value === "" && items[0]) onChange(items.find((program) => program.key === "standard")?.id ?? items[0].id);
  }, [items, value, onChange]);
  return (
    <Field label={t("admin.referrals.program")}>
      {(control) => (
        <Select {...control} name="program" value={value} onChange={(event) => { onChange(event.target.value); }}>
          {items.map((program) => <option key={program.id} value={program.id}>{program.nameAr}</option>)}
        </Select>
      )}
    </Field>
  );
}

function WhatIf({ programId }: { programId: string }) {
  const [event, setEvent] = useState<(typeof REWARD_EVENTS)[number]>("first_payment");
  const [amount, setAmount] = useState("299");
  const [dealId, setDealId] = useState("");
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const run = async () => {
    const pounds = Number(amount);
    if (!Number.isFinite(pounds) || pounds < 0) return;
    setFailure(null);
    try {
      setResult(
        await api("/admin/growth/rules/what-if", {
          method: "POST",
          body: {
            programId,
            event,
            netMinor: Math.round(pounds * 100),
            ...(/^[0-9a-f-]{36}$/i.test(dealId.trim()) ? { dealId: dealId.trim() } : {}),
          },
          schema: whatIfResultSchema,
        }),
      );
    } catch (error) {
      setFailure(error);
    }
  };
  return (
    <Card elevation="flat" className="flex flex-col gap-3" data-testid="what-if">
      <h3 className="font-semibold text-text">{t("admin.referrals.whatIf")}</h3>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={t("admin.referrals.event")}>
          {(control) => (
            <Select {...control} name="what-if-event" value={event} onChange={(e) => { setEvent(e.target.value as typeof event); }}>
              {REWARD_EVENTS.map((value) => <option key={value} value={value}>{t(`admin.growth.event.${value}` as MessageKey)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t("admin.referrals.net")}>
          {(control) => <Input {...control} name="what-if-net" inputMode="decimal" ltr value={amount} onChange={(e) => { setAmount(e.target.value); }} />}
        </Field>
        <Field label={t("admin.referrals.whatIfDeal")} hint={t("admin.referrals.whatIfDealHint")}>
          {(control) => <Input {...control} name="what-if-deal" ltr value={dealId} onChange={(e) => { setDealId(e.target.value); }} />}
        </Field>
        <div className="flex items-end">
          <Button name="run-what-if" onClick={() => { void run(); }}>{t("admin.referrals.calculate")}</Button>
        </div>
      </div>
      {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
      {result ? (
        <ul className="flex flex-col gap-1 text-base text-text">
          {result.beneficiaries.map((row) => (
            <li key={row.beneficiary} data-testid={`what-if-${row.beneficiary}`}>
              {`${t(`admin.referrals.beneficiary.${row.beneficiary}` as MessageKey)}: `}
              {row.source === null
                ? t("admin.referrals.noRule")
                : t("admin.referrals.whatIfLine", {
                    points: formatNumber(row.points),
                    credits: formatNumber(row.credits),
                    value: moneyText(row.valueMinor, result.currency),
                    days: formatNumber(row.holdDays),
                  })}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function RuleDialog({ programId, open, onClose, onSaved }: { programId: string; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [event, setEvent] = useState<(typeof REWARD_EVENTS)[number]>("first_payment");
  const [beneficiary, setBeneficiary] = useState<(typeof REWARD_BENEFICIARIES)[number]>("referrer");
  const [kind, setKind] = useState<(typeof REWARD_KINDS)[number]>("percent_of_net_bps");
  const [value, setValue] = useState("");
  const [redeemable, setRedeemable] = useState<(typeof REWARD_REDEEMABLE_AS)[number]>("cash_or_credits");
  const [hold, setHold] = useState("14");
  const number = kind === "percent_of_net_bps" ? Math.round(Number(value) * 100) : Number(value);
  const valid = value.trim() !== "" && Number.isInteger(number) && number >= 0 && /^\d{1,3}$/.test(hold);
  return (
    <ReasonDialog
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={t("admin.referrals.newRule")}
      effect={t("admin.referrals.newRuleEffect")}
      confirmLabel={t("admin.referrals.saveRule")}
      canSubmit={valid}
      onConfirm={async (reason) => {
        await api(`/admin/growth/programs/${programId}/rules`, {
          method: "POST",
          body: { event, beneficiary, rewardKind: kind, value: number, redeemableAs: redeemable, holdDays: Number(hold), priority: 10, reason },
        });
        onSaved();
        onClose();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("admin.referrals.event")}>
          {(control) => <Select {...control} name="rule-event" value={event} onChange={(e) => { setEvent(e.target.value as typeof event); }}>{REWARD_EVENTS.map((v) => <option key={v} value={v}>{t(`admin.growth.event.${v}` as MessageKey)}</option>)}</Select>}
        </Field>
        <Field label={t("admin.referrals.beneficiaryLabel")}>
          {(control) => <Select {...control} name="rule-beneficiary" value={beneficiary} onChange={(e) => { setBeneficiary(e.target.value as typeof beneficiary); }}>{REWARD_BENEFICIARIES.map((v) => <option key={v} value={v}>{t(`admin.referrals.beneficiary.${v}` as MessageKey)}</option>)}</Select>}
        </Field>
        <Field label={t("admin.referrals.kind")}>
          {(control) => <Select {...control} name="rule-kind" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); }}>{REWARD_KINDS.map((v) => <option key={v} value={v}>{t(`admin.referrals.kind.${v}` as MessageKey)}</option>)}</Select>}
        </Field>
        <Field label={kind === "percent_of_net_bps" ? t("admin.referrals.valuePercent") : t("admin.referrals.value")}>
          {(control) => <Input {...control} name="rule-value" inputMode="decimal" ltr value={value} onChange={(e) => { setValue(e.target.value); }} />}
        </Field>
        <Field label={t("admin.referrals.redeemable")}>
          {(control) => <Select {...control} name="rule-redeemable" value={redeemable} onChange={(e) => { setRedeemable(e.target.value as typeof redeemable); }}>{REWARD_REDEEMABLE_AS.map((v) => <option key={v} value={v}>{t(`rewards.rule_sentence.redeem.${v}` as MessageKey)}</option>)}</Select>}
        </Field>
        <Field label={t("admin.referrals.hold")}>
          {(control) => <Input {...control} name="rule-hold" inputMode="numeric" ltr value={hold} onChange={(e) => { setHold(e.target.value); }} />}
        </Field>
      </div>
    </ReasonDialog>
  );
}

function RulesTab({ canWrite }: { canWrite: boolean }) {
  const [programId, setProgramId] = useState("");
  const [adding, setAdding] = useState(false);
  const rules = useResource(programId ? `/admin/growth/programs/${programId}/rules` : null, ruleListSchema);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64"><ProgramPicker value={programId} onChange={setProgramId} /></div>
        {canWrite && programId ? (
          <Button variant="secondary" name="new-rule" onClick={() => { setAdding(true); }}>
            <Plus aria-hidden className="size-4" />
            {t("admin.referrals.newRule")}
          </Button>
        ) : null}
      </div>
      {programId ? (
        <ResourceBoundary resource={rules}>
          {(data) => (
            <ul className="flex flex-col gap-2" data-testid="rules">
              {data.items.map((rule) => (
                <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <span className="text-base text-text">{renderRuleSentence(rule.sentence, "ar")}</span>
                  <span className="text-sm text-text-muted">{rule.active ? t("admin.referrals.active") : t("admin.referrals.inactive")}</span>
                </li>
              ))}
            </ul>
          )}
        </ResourceBoundary>
      ) : null}
      {programId ? <WhatIf programId={programId} /> : null}
      {programId ? <RuleDialog programId={programId} open={adding} onClose={() => { setAdding(false); }} onSaved={rules.reload} /> : null}
    </div>
  );
}

function TiersTab() {
  const [programId, setProgramId] = useState("");
  const tiers = useResource(programId ? `/admin/growth/programs/${programId}/tiers` : null, tierListSchema);
  return (
    <div className="flex flex-col gap-4">
      <div className="min-w-64"><ProgramPicker value={programId} onChange={setProgramId} /></div>
      {programId ? (
        <ResourceBoundary resource={tiers}>
          {(data) =>
            data.items.length === 0 ? (
              <p className="text-base text-text-muted">{t("admin.referrals.noTiers")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.items.map((tier) => (
                  <li key={tier.id} className="text-base text-text">
                    {t("admin.referrals.tierLine", { name: tier.nameAr, min: formatNumber(tier.minPaidReferrals), bonus: String(tier.bonusBps / 100), members: formatNumber(tier.memberCount) })}
                  </li>
                ))}
              </ul>
            )
          }
        </ResourceBoundary>
      ) : null}
    </div>
  );
}

function CodesTab({ canWrite }: { canWrite: boolean }) {
  const { toast } = useToast();
  const url = useUrlParams();
  const list = useCursorList("/admin/growth/codes", "", codeListSchema);
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<"partner" | "organization" | "campaign">("partner");
  const [owner, setOwner] = useState<PickedUser | null>(null);
  const [orgId, setOrgId] = useState("");
  const [code, setCode] = useState("");
  const [dealId, setDealId] = useState("");
  const [failure, setFailure] = useState<unknown>(null);
  const [pausing, setPausing] = useState<CodeView | null>(null);
  const highlighted = url.get("code");
  const ready = kind === "partner" ? owner !== null : kind === "organization" ? /^[0-9a-f-]{36}$/i.test(orgId.trim()) : true;
  const create = async () => {
    setFailure(null);
    try {
      const created = await api("/admin/growth/codes", {
        method: "POST",
        body: {
          kind,
          ...(code.trim() ? { code: code.trim().toUpperCase() } : {}),
          ...(kind === "partner" && owner ? { ownerUserId: owner.id } : {}),
          ...(kind === "organization" ? { orgId: orgId.trim() } : {}),
          ...(/^[0-9a-f-]{36}$/i.test(dealId.trim()) ? { dealId: dealId.trim() } : {}),
        },
        schema: z.object({ id: z.string() }).loose(),
      });
      toast({ tone: "success", title: t("admin.referrals.codeCreated") });
      setCreating(false);
      setCode("");
      setOwner(null);
      list.reload();
      return created;
    } catch (error) {
      setFailure(error);
      return null;
    }
  };
  return (
    <div className="flex flex-col gap-4">
      {canWrite ? (
        <div>
          <Button name="new-code" onClick={() => { setCreating(true); }}>
            <Plus aria-hidden className="size-4" />
            {t("admin.referrals.newCode")}
          </Button>
        </div>
      ) : null}
      {list.status === "error" ? <ErrorNotice error={list.error} onRetry={list.reload} /> : null}
      <ul className="flex flex-col gap-2" data-testid="codes">
        {list.items.map((row) => (
          <li key={row.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${highlighted === row.id ? "border-primary" : "border-border"}`}>
            <span className="flex flex-wrap items-center gap-3">
              <bdi dir="ltr" className="font-semibold text-text">{row.code}</bdi>
              <span className="text-sm text-text-muted">{t(`admin.referrals.codeKind.${row.kind}` as MessageKey)}</span>
              <span className="text-sm text-text-muted">{row.ownerInitials ?? row.ownerOrgName ?? ""}</span>
              <span className="text-sm text-text-muted">{t("admin.referrals.codeReferrals", { count: formatNumber(row.referrals) })}</span>
              {row.dealIds.length > 0 ? <span className="text-sm text-success">{t("admin.referrals.hasDeal")}</span> : null}
            </span>
            {canWrite ? (
              row.active ? (
                <Button variant="ghost" onClick={() => { setPausing(row); }}>{t("admin.referrals.pause")}</Button>
              ) : (
                <span className="text-sm text-text-muted">{t("admin.referrals.paused")}</span>
              )
            ) : null}
          </li>
        ))}
      </ul>
      {list.nextCursor ? <Button variant="secondary" loading={list.loadingMore} onClick={list.loadMore}>{t("admin.table.loadMore")}</Button> : null}
      <Dialog open={creating} onOpenChange={(next) => { if (!next) setCreating(false); }} title={t("admin.referrals.newCode")}>
        <form noValidate className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <Field label={t("admin.referrals.codeKindLabel")}>
            {(control) => (
              <Select {...control} name="code-kind" value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); }}>
                {(["partner", "organization", "campaign"] as const).map((value) => <option key={value} value={value}>{t(`admin.referrals.codeKind.${value}` as MessageKey)}</option>)}
              </Select>
            )}
          </Field>
          {kind === "partner" ? <UserPicker label={t("admin.referrals.partner")} value={owner} onChange={setOwner} /> : null}
          {kind === "organization" ? (
            <Field label={t("admin.referrals.orgId")}>
              {(control) => <Input {...control} name="code-org" ltr value={orgId} onChange={(event) => { setOrgId(event.target.value); }} />}
            </Field>
          ) : null}
          <Field label={t("admin.referrals.codeText")} hint={t("admin.referrals.codeTextHint")}>
            {(control) => <Input {...control} name="code-text" ltr value={code} onChange={(event) => { setCode(event.target.value); }} />}
          </Field>
          <Field label={t("admin.referrals.codeDeal")} hint={t("admin.referrals.codeDealHint")}>
            {(control) => <Input {...control} name="code-deal" ltr value={dealId} onChange={(event) => { setDealId(event.target.value); }} />}
          </Field>
          {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => { setCreating(false); }}>{t("common.cancel")}</Button>
            <Button type="submit" name="create-code" disabled={!ready}>{t("admin.referrals.createCode")}</Button>
          </div>
        </form>
      </Dialog>
      <ReasonDialog
        open={pausing !== null}
        onOpenChange={(open) => { if (!open) setPausing(null); }}
        title={t("admin.referrals.pauseTitle", { code: pausing?.code ?? "" })}
        effect={t("admin.referrals.pauseEffect")}
        confirmLabel={t("admin.referrals.pause")}
        onConfirm={async (reason) => {
          if (!pausing) return;
          await api(`/admin/growth/codes/${pausing.id}/pause`, { method: "POST", body: { reason }, schema: codeViewSchema.partial().loose() });
          setPausing(null);
          list.reload();
        }}
      />
    </div>
  );
}

function TreeTab() {
  const [user, setUser] = useState<PickedUser | null>(null);
  const tree = useResource(user ? `/admin/growth/referrals/tree?userId=${user.id}&depth=2` : null, referralTreeSchema);
  return (
    <div className="flex flex-col gap-4">
      <UserPicker label={t("admin.referrals.treeUser")} value={user} onChange={setUser} />
      {user ? (
        <ResourceBoundary resource={tree}>
          {(data) => (
            <div className="flex flex-col gap-2 text-base text-text">
              {data.ancestors.length > 0 ? <p className="text-sm text-text-muted">{t("admin.referrals.ancestors", { chain: data.ancestors.map((node) => node.initials).join(" ← ") })}</p> : null}
              <p className="font-semibold">{`${data.root.initials} · ${t("admin.referrals.nodeLine", { points: formatNumber(data.root.pointsEarned), orders: formatNumber(data.root.paidOrders) })}`}</p>
              <ul className="flex flex-col gap-1">
                {data.descendants.map((node) => (
                  <li key={node.userId} className="flex flex-wrap items-center gap-2">
                    <span className="text-text-muted">{"↳".repeat(node.depth)}</span>
                    <span>{node.initials}</span>
                    {node.status ? <StatusChip kind="referral" status={node.status} /> : null}
                    <span className="text-sm text-text-muted">{t("admin.referrals.nodeLine", { points: formatNumber(node.pointsEarned), orders: formatNumber(node.paidOrders) })}</span>
                    {node.fraudFlags.map((flag) => <span key={flag} className="rounded bg-warning-soft px-1.5 text-sm">{tOr(`admin.growth.flag.${flag}`, flag)}</span>)}
                  </li>
                ))}
              </ul>
              {data.truncated ? <p className="text-sm text-text-muted">{t("admin.referrals.truncated")}</p> : null}
            </div>
          )}
        </ResourceBoundary>
      ) : null}
    </div>
  );
}

function SettingsTab() {
  const preview = useResource("/admin/growth/settings/rewards/preview", rewardsPreviewSchema);
  return (
    <ResourceBoundary resource={preview}>
      {(data) => (
        <div className="flex flex-col gap-3">
          <p className="text-base text-text">{t("admin.referrals.pointValue", { value: moneyText(data.pointValueMinor * 1_000, data.currency) })}</p>
          <ul className="flex flex-col gap-1 text-base text-text">
            {data.fields.map((field) => (
              <li key={field.key}>{`${t(`admin.referrals.setting.${field.key}` as MessageKey)}: ${formatNumber(field.points)} ≈ ${moneyText(field.valueMinor, data.currency)}`}</li>
            ))}
          </ul>
          <Link href="/admin/settings?key=rewards" className="text-primary underline">{t("admin.referrals.editSettings")}</Link>
        </div>
      )}
    </ResourceBoundary>
  );
}

/** `/admin/growth/referrals` (ADMIN-CONSOLE-SPEC §6.1). */
export function GrowthReferralsView({ canWrite }: { canWrite: boolean }) {
  const url = useUrlParams();
  const [tab, setTab] = useState(url.get("code") ? "codes" : "rules");
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabList aria-label={t("admin.nav.referrals")} className="flex-wrap">
        {(["rules", "tiers", "codes", "tree", "settings"] as const).map((value) => <Tab key={value} value={value}>{t(`admin.referrals.tab.${value}` as MessageKey)}</Tab>)}
      </TabList>
      <TabPanel value="rules" className="pt-4">{tab === "rules" ? <RulesTab canWrite={canWrite} /> : null}</TabPanel>
      <TabPanel value="tiers" className="pt-4">{tab === "tiers" ? <TiersTab /> : null}</TabPanel>
      <TabPanel value="codes" className="pt-4">{tab === "codes" ? <CodesTab canWrite={canWrite} /> : null}</TabPanel>
      <TabPanel value="tree" className="pt-4">{tab === "tree" ? <TreeTab /> : null}</TabPanel>
      <TabPanel value="settings" className="pt-4">{tab === "settings" ? <SettingsTab /> : null}</TabPanel>
    </Tabs>
  );
}

