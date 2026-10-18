"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { adminOrgListResponseSchema } from "@wasfa/shared/schemas/admin";
import {
  dealDetailSchema,
  dealListResponseSchema,
  dealViewSchema,
  simulateDealResponseSchema,
  type DealTargetInput,
  type DealTerms,
  type DealView,
  type SimulateDealResponse,
} from "@wasfa/shared/schemas/deals";
import { joinLinkItemSchema } from "@wasfa/shared/schemas/org";
import { planListResponseSchema } from "@wasfa/shared/schemas/plans";
import { Button, Checkbox, Dialog, Field, Input, Select, moneyText, useToast } from "@wasfa/ui";
import { Handshake, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { formatDateTime, formatNumber, tOr } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { useReauth } from "../../lib/reauth";
import { buildQuery, useCursorList, useResource } from "../../lib/use-admin-data";
import { useQrCode } from "../../lib/use-qr-code";
import { useUrlParams } from "../../lib/use-url-params";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import { DataTable, type DataTableColumn } from "./data-table";
import { RecordDrawer, useOpenRecord } from "./record-drawer";
import { ResourceBoundary } from "./resource-boundary";
import { StatusChip } from "./status-chip";
import { UserPicker, type PickedUser } from "./user-picker";

type TargetKind = DealTargetInput["kind"];
interface PricingRow {
  planKey: string;
  mode: "fixed" | "percent_off";
  amount: string;
  currency: string;
  percent: string;
}

const intOrNull = (text: string) => (/^\d{1,9}$/.test(text.trim()) ? Number(text.trim()) : null);

/** A plain-language summary of the terms (ADMIN-CONSOLE-SPEC §6.4 step 2). */
export function termsSummary(terms: DealTerms): string[] {
  const out: string[] = [];
  for (const term of terms.pricing) {
    out.push(
      term.mode === "fixed"
        ? t("admin.deals.summary.fixed", { plan: term.planKey, price: moneyText(term.amountMinor, term.currency) })
        : t("admin.deals.summary.percent", { plan: term.planKey, percent: String(term.bps / 100) }),
    );
  }
  if (terms.membership) out.push(t("admin.deals.summary.membership", { months: String(terms.membership.durationMonths) }));
  if (terms.rewards) {
    out.push(
      t("admin.deals.summary.rewards", {
        percent: String(terms.rewards.referrerPaymentBps / 100),
        points: formatNumber(terms.rewards.referrerSignupPoints),
      }),
    );
  }
  if (terms.credits && terms.credits.welcomeCredits > 0) {
    out.push(t("admin.deals.summary.welcome", { credits: formatNumber(terms.credits.welcomeCredits) }));
  }
  if (terms.credits && terms.credits.monthlyBonusCredits > 0) {
    out.push(t("admin.deals.summary.monthly", { credits: formatNumber(terms.credits.monthlyBonusCredits) }));
  }
  if (terms.seats) out.push(t("admin.deals.summary.seats", { seats: formatNumber(terms.seats.maxMembers) }));
  if (terms.billing && terms.billing.mode !== "self_pay") {
    out.push(t(`admin.deals.billing.${terms.billing.mode}` as MessageKey));
  }
  return out;
}

function OrgPicker({ value, onChange }: { value: { id: string; name: string } | null; onChange: (value: { id: string; name: string } | null) => void }) {
  const [query, setQuery] = useState("");
  const results = useResource(
    !value && query.trim().length >= 2 ? `/admin/orgs?${buildQuery({ q: query.trim(), limit: "5" })}` : null,
    adminOrgListResponseSchema,
  );
  if (value) {
    return (
      <div className="flex items-center gap-3">
        <span className="font-semibold text-text" data-testid="picked-org">{value.name}</span>
        <Button variant="ghost" onClick={() => { onChange(null); }}>{t("admin.deals.change")}</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Field label={t("admin.deals.target.org")}>
        {(control) => <Input {...control} name="org-search" value={query} onChange={(event) => { setQuery(event.target.value); }} />}
      </Field>
      {results.status === "ready" ? (
        <ul className="flex flex-col gap-1">
          {results.data.items.map((org) => (
            <li key={org.id}>
              <Button variant="secondary" className="w-full justify-start" onClick={() => { onChange({ id: org.id, name: org.name }); }}>
                {`${org.name} · ${formatNumber(org.memberCount)}`}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SimulationResult({ result }: { result: SimulateDealResponse }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-neutral-100 p-4" data-testid="deal-preview">
      {result.error ? <Notice tone="warning">{tOr(`error.${result.error}`, result.error)}</Notice> : null}
      {result.before && result.after ? (
        <p className="text-base text-text">
          {t("admin.deals.preview.prices", {
            before: moneyText(result.before.totalMinor, result.before.currency),
            after: moneyText(result.after.totalMinor, result.after.currency),
          })}
        </p>
      ) : null}
      {result.deal.chosenBecause ? (
        <p className="text-sm text-text-muted">
          {tOr(result.deal.chosenBecause.key, result.deal.chosen?.name ?? "", result.deal.chosenBecause.params)}
        </p>
      ) : (
        <p className="text-sm text-text-muted">{t("admin.deals.preview.none")}</p>
      )}
      {result.deal.candidates
        .filter((candidate) => !candidate.chosen)
        .map((candidate) => (
          <p key={candidate.dealId} className="text-sm text-text-muted">
            {`${candidate.name}: ${tOr(candidate.reason.key, candidate.reason.key, candidate.reason.params)}`}
          </p>
        ))}
    </div>
  );
}

function JoinLinkCard({ slug }: { slug: string }) {
  const href = `${window.location.origin}/join/${slug}`;
  const qr = useQrCode(href, 180);
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-success/40 bg-success-soft p-4" data-testid="join-link-card">
      {qr ? (
        // eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URL made in the browser
        <img src={qr} alt={t("admin.deals.link.qr")} className="size-40 rounded bg-white p-1" />
      ) : null}
      <div className="flex flex-col gap-2">
        <p className="font-semibold text-text">{t("admin.deals.link.ready")}</p>
        <bdi dir="ltr" className="break-all text-base text-text" data-testid="join-link-url">{href}</bdi>
        <Button variant="secondary" onClick={() => { window.print(); }}>{t("admin.deals.link.print")}</Button>
      </div>
    </div>
  );
}

const STEPS = ["who", "what", "duration", "preview", "done"] as const;
type Step = (typeof STEPS)[number];

/**
 * The deal wizard (ADMIN-CONSOLE-SPEC §6.4): who, what (price rules, rewards, credits, seats,
 * billing), how long and stacking, a preview through the simulator, then create, activate and,
 * for an organisation, its join link with a printable QR card in one step.
 */
function DealWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const reauth = useReauth();
  const plans = useResource("/admin/plans", planListResponseSchema);
  const [step, setStep] = useState<Step>("who");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TargetKind>("organization");
  const [org, setOrg] = useState<{ id: string; name: string } | null>(null);
  const [user, setUser] = useState<PickedUser | null>(null);
  const [codeId, setCodeId] = useState("");
  const [domain, setDomain] = useState("");
  const [memberOnly, setMemberOnly] = useState(true);
  const [pricing, setPricing] = useState<PricingRow[]>([
    { planKey: "plus", mode: "fixed", amount: "", currency: "EGP", percent: "" },
  ]);
  const [paymentPercent, setPaymentPercent] = useState("");
  const [signupPoints, setSignupPoints] = useState("");
  const [welcomeCredits, setWelcomeCredits] = useState("");
  const [monthlyCredits, setMonthlyCredits] = useState("");
  const [seats, setSeats] = useState("");
  const [billing, setBilling] = useState<"self_pay" | "org_pays" | "manual_invoice">("self_pay");
  const [membershipMonths, setMembershipMonths] = useState("12");
  const [newMembersOnly, setNewMembersOnly] = useState(false);
  const [stackPromotions, setStackPromotions] = useState(false);
  const [stackCoupons, setStackCoupons] = useState(false);
  const [endsAt, setEndsAt] = useState("");
  const [slug, setSlug] = useState("");
  const [simulation, setSimulation] = useState<SimulateDealResponse | null>(null);
  const [created, setCreated] = useState<{ deal: DealView; slug: string | null } | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const target = useMemo((): DealTargetInput | null => {
    if (kind === "organization") return org ? { kind, orgId: org.id, memberOnly } : null;
    if (kind === "user") return user ? { kind, userId: user.id, memberOnly: false } : null;
    if (kind === "referral_code") return /^[0-9a-f-]{36}$/i.test(codeId.trim()) ? { kind, referralCodeId: codeId.trim(), memberOnly: false } : null;
    return domain.trim().length > 3 ? { kind, emailDomain: domain.trim().toLowerCase(), memberOnly: false } : null;
  }, [kind, org, user, codeId, domain, memberOnly]);

  const terms = useMemo((): DealTerms | null => {
    const rows: DealTerms["pricing"] = [];
    for (const row of pricing) {
      if (row.mode === "fixed") {
        const pounds = /^\d+(\.\d{1,2})?$/.test(row.amount.trim()) ? Math.round(Number(row.amount.trim()) * 100) : null;
        if (pounds === null) continue;
        rows.push({ planKey: row.planKey, mode: "fixed", amountMinor: pounds, currency: row.currency });
      } else {
        const percent = /^\d{1,3}(\.\d{1,2})?$/.test(row.percent.trim()) ? Math.round(Number(row.percent.trim()) * 100) : null;
        if (percent === null || percent < 1 || percent > 10_000) continue;
        rows.push({ planKey: row.planKey, mode: "percent_off", bps: percent });
      }
    }
    const paymentBps = paymentPercent.trim() === "" ? null : Math.round(Number(paymentPercent.trim()) * 100);
    const signup = intOrNull(signupPoints);
    const welcome = intOrNull(welcomeCredits);
    const monthly = intOrNull(monthlyCredits);
    const seatCount = intOrNull(seats);
    const months = intOrNull(membershipMonths);
    return {
      pricing: rows,
      stackWithPromotions: stackPromotions,
      stackWithCoupons: stackCoupons,
      ...(kind === "organization" && months ? { membership: { durationMonths: months, newMembersOnly } } : {}),
      ...(paymentBps !== null || signup !== null
        ? { rewards: { referrerSignupPoints: signup ?? 0, referrerPaymentBps: paymentBps ?? 0, refereeSignupCredits: 0, maxRenewals: 6 } }
        : {}),
      ...(welcome !== null || monthly !== null ? { credits: { welcomeCredits: welcome ?? 0, monthlyBonusCredits: monthly ?? 0 } } : {}),
      ...(seatCount ? { seats: { maxMembers: seatCount } } : {}),
      ...(billing !== "self_pay" ? { billing: { mode: billing } } : {}),
    };
  }, [pricing, paymentPercent, signupPoints, welcomeCredits, monthlyCredits, seats, membershipMonths, newMembersOnly, stackPromotions, stackCoupons, billing, kind]);

  const createDeal = async (): Promise<DealView> => {
    const deal = await api("/admin/growth/deals", {
      method: "POST",
      body: {
        name: name.trim(),
        terms,
        endsAt: endsAt ? new Date(`${endsAt}T23:59:59Z`).toISOString() : null,
        targets: target ? [target] : [],
      },
      schema: dealViewSchema,
    });
    return deal;
  };

  const preview = async () => {
    if (!terms || !target) return;
    setBusy(true);
    setFailure(null);
    try {
      // Preview on the real engine: the draft is created first, simulated, and activated only on "create".
      const deal = created?.deal ?? (await createDeal());
      setCreated({ deal, slug: null });
      const subject =
        target.kind === "organization"
          ? { newMember: { orgId: target.orgId } }
          : target.kind === "user"
            ? { userId: target.userId }
            : null;
      const firstPlan = terms.pricing[0]?.planKey ?? "plus";
      if (subject) {
        setSimulation(
          await api("/admin/growth/deals/simulate", {
            method: "POST",
            body: { ...subject, planKey: firstPlan, months: 1 },
            schema: simulateDealResponseSchema,
          }),
        );
      }
      setStep("preview");
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    if (!created) return;
    setBusy(true);
    setFailure(null);
    try {
      await reauth.run(() => api(`/admin/growth/deals/${created.deal.id}/activate`, { method: "POST", body: {} }));
      let linkSlug: string | null = null;
      if (target?.kind === "organization" && slug.trim() !== "") {
        const link = await api(`/admin/orgs/${target.orgId}/join-links`, {
          method: "POST",
          body: { slug: slug.trim().toLowerCase(), dealId: created.deal.id },
          schema: joinLinkItemSchema,
        });
        linkSlug = link.slug;
      }
      setCreated({ deal: created.deal, slug: linkSlug });
      toast({ tone: "success", title: t("admin.deals.created") });
      onCreated();
      setStep("done");
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  const updatePricing = (index: number, patch: Partial<PricingRow>) => {
    setPricing((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const planChoices = plans.status === "ready" ? plans.data.items.filter((plan) => !plan.isDefault) : [];

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label={t("admin.deals.steps")}>
        {STEPS.map((entry, index) => (
          <li key={entry} aria-current={entry === step ? "step" : undefined} className={entry === step ? "rounded-full bg-primary px-3 py-1 text-on-primary" : "rounded-full bg-neutral-100 px-3 py-1 text-text-muted"}>
            {`${String(index + 1)}. ${t(`admin.deals.step.${entry}` as MessageKey)}`}
          </li>
        ))}
      </ol>

      {step === "who" ? (
        <div className="flex flex-col gap-4">
          <Field label={t("admin.deals.name")} required>
            {(control) => <Input {...control} name="deal-name" maxLength={120} value={name} onChange={(event) => { setName(event.target.value); }} />}
          </Field>
          <Field label={t("admin.deals.target.kind")}>
            {(control) => (
              <Select {...control} name="target-kind" value={kind} onChange={(event) => { setKind(event.target.value as TargetKind); }}>
                {(["organization", "user", "referral_code", "email_domain"] as const).map((value) => (
                  <option key={value} value={value}>{t(`admin.deals.target.${value}` as MessageKey)}</option>
                ))}
              </Select>
            )}
          </Field>
          {kind === "organization" ? (
            <>
              <OrgPicker value={org} onChange={setOrg} />
              <Checkbox name="member-only" label={t("admin.deals.target.memberOnly")} checked={memberOnly} onChange={(event) => { setMemberOnly(event.target.checked); }} />
            </>
          ) : null}
          {kind === "user" ? <UserPicker label={t("admin.deals.target.user")} value={user} onChange={setUser} /> : null}
          {kind === "referral_code" ? (
            <Field label={t("admin.deals.target.code")} hint={t("admin.deals.target.codeHint")}>
              {(control) => <Input {...control} name="code-id" ltr value={codeId} onChange={(event) => { setCodeId(event.target.value); }} />}
            </Field>
          ) : null}
          {kind === "email_domain" ? (
            <Field label={t("admin.deals.target.domain")} hint={t("admin.deals.target.domainHint")}>
              {(control) => <Input {...control} name="domain" ltr value={domain} onChange={(event) => { setDomain(event.target.value); }} />}
            </Field>
          ) : null}
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
            <Button name="next-what" disabled={name.trim() === "" || target === null} onClick={() => { setStep("what"); }}>{t("admin.deals.next")}</Button>
          </div>
        </div>
      ) : null}

      {step === "what" ? (
        <div className="flex flex-col gap-4">
          <h3 className="font-semibold text-text">{t("admin.deals.pricing")}</h3>
          {pricing.map((row, index) => (
            <div key={String(index)} className="grid gap-3 sm:grid-cols-4">
              <Field label={t("admin.deals.plan")}>
                {(control) => (
                  <Select {...control} name={`plan-${String(index)}`} value={row.planKey} onChange={(event) => { updatePricing(index, { planKey: event.target.value }); }}>
                    {planChoices.map((plan) => <option key={plan.key} value={plan.key}>{plan.nameAr}</option>)}
                  </Select>
                )}
              </Field>
              <Field label={t("admin.deals.mode")}>
                {(control) => (
                  <Select {...control} name={`mode-${String(index)}`} value={row.mode} onChange={(event) => { updatePricing(index, { mode: event.target.value as PricingRow["mode"] }); }}>
                    <option value="fixed">{t("admin.deals.mode.fixed")}</option>
                    <option value="percent_off">{t("admin.deals.mode.percent")}</option>
                  </Select>
                )}
              </Field>
              {row.mode === "fixed" ? (
                <>
                  <Field label={t("admin.deals.price")}>
                    {(control) => <Input {...control} name={`price-${String(index)}`} inputMode="decimal" ltr value={row.amount} onChange={(event) => { updatePricing(index, { amount: event.target.value }); }} />}
                  </Field>
                  <Field label={t("admin.deals.currency")}>
                    {(control) => <Input {...control} name={`currency-${String(index)}`} ltr maxLength={3} value={row.currency} onChange={(event) => { updatePricing(index, { currency: event.target.value.toUpperCase() }); }} />}
                  </Field>
                </>
              ) : (
                <Field label={t("admin.deals.percent")}>
                  {(control) => <Input {...control} name={`percent-${String(index)}`} inputMode="decimal" ltr value={row.percent} onChange={(event) => { updatePricing(index, { percent: event.target.value }); }} />}
                </Field>
              )}
            </div>
          ))}
          <Button variant="ghost" className="self-start" onClick={() => { setPricing((rows) => [...rows, { planKey: "pro", mode: "percent_off", amount: "", currency: "EGP", percent: "" }]); }}>
            <Plus aria-hidden className="size-4" />
            {t("admin.deals.addPrice")}
          </Button>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("admin.deals.rewardPercent")} hint={t("admin.deals.rewardPercentHint")}>
              {(control) => <Input {...control} name="reward-percent" inputMode="decimal" ltr value={paymentPercent} onChange={(event) => { setPaymentPercent(event.target.value); }} />}
            </Field>
            <Field label={t("admin.deals.signupPoints")}>
              {(control) => <Input {...control} name="signup-points" inputMode="numeric" ltr value={signupPoints} onChange={(event) => { setSignupPoints(event.target.value); }} />}
            </Field>
            <Field label={t("admin.deals.welcomeCredits")}>
              {(control) => <Input {...control} name="welcome-credits" inputMode="numeric" ltr value={welcomeCredits} onChange={(event) => { setWelcomeCredits(event.target.value); }} />}
            </Field>
            <Field label={t("admin.deals.monthlyCredits")}>
              {(control) => <Input {...control} name="monthly-credits" inputMode="numeric" ltr value={monthlyCredits} onChange={(event) => { setMonthlyCredits(event.target.value); }} />}
            </Field>
            <Field label={t("admin.deals.seats")}>
              {(control) => <Input {...control} name="seats" inputMode="numeric" ltr value={seats} onChange={(event) => { setSeats(event.target.value); }} />}
            </Field>
            <Field label={t("admin.deals.billingMode")}>
              {(control) => (
                <Select {...control} name="billing-mode" value={billing} onChange={(event) => { setBilling(event.target.value as typeof billing); }}>
                  {(["self_pay", "org_pays", "manual_invoice"] as const).map((value) => (
                    <option key={value} value={value}>{t(`admin.deals.billing.${value}` as MessageKey)}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {terms ? (
            <ul className="list-disc ps-5 text-sm text-text" data-testid="deal-summary">
              {termsSummary(terms).map((line) => <li key={line}>{line}</li>)}
            </ul>
          ) : null}
          <div className="flex justify-between gap-3">
            <Button variant="ghost" onClick={() => { setStep("who"); }}>{t("admin.deals.back")}</Button>
            <Button name="next-duration" disabled={!terms || (terms.pricing.length === 0 && !terms.rewards && !terms.credits && !terms.seats)} onClick={() => { setStep("duration"); }}>{t("admin.deals.next")}</Button>
          </div>
        </div>
      ) : null}

      {step === "duration" ? (
        <div className="flex flex-col gap-4">
          {kind === "organization" ? (
            <>
              <Field label={t("admin.deals.membershipMonths")} hint={t("admin.deals.membershipHint")}>
                {(control) => <Input {...control} name="membership-months" inputMode="numeric" ltr value={membershipMonths} onChange={(event) => { setMembershipMonths(event.target.value); }} />}
              </Field>
              <Checkbox name="new-members" label={t("admin.deals.newMembersOnly")} checked={newMembersOnly} onChange={(event) => { setNewMembersOnly(event.target.checked); }} />
              <Field label={t("admin.deals.linkSlug")} hint={t("admin.deals.linkSlugHint")}>
                {(control) => <Input {...control} name="link-slug" ltr value={slug} onChange={(event) => { setSlug(event.target.value); }} />}
              </Field>
            </>
          ) : null}
          <Field label={t("admin.deals.endsAt")} hint={t("admin.deals.endsAtHint")}>
            {(control) => <Input {...control} name="ends-at" type="date" ltr value={endsAt} onChange={(event) => { setEndsAt(event.target.value); }} />}
          </Field>
          <Checkbox name="stack-promotions" label={t("admin.deals.stackPromotions")} checked={stackPromotions} onChange={(event) => { setStackPromotions(event.target.checked); }} />
          <Checkbox name="stack-coupons" label={t("admin.deals.stackCoupons")} checked={stackCoupons} onChange={(event) => { setStackCoupons(event.target.checked); }} />
          {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
          <div className="flex justify-between gap-3">
            <Button variant="ghost" onClick={() => { setStep("what"); }}>{t("admin.deals.back")}</Button>
            <Button name="preview-deal" loading={busy} onClick={() => { void preview(); }}>{t("admin.deals.preview")}</Button>
          </div>
        </div>
      ) : null}

      {step === "preview" ? (
        <div className="flex flex-col gap-4">
          {terms ? <ul className="list-disc ps-5 text-sm text-text">{termsSummary(terms).map((line) => <li key={line}>{line}</li>)}</ul> : null}
          {simulation ? <SimulationResult result={simulation} /> : <p className="text-sm text-text-muted">{t("admin.deals.preview.noSubject")}</p>}
          <p className="text-sm text-text-muted">{t("admin.deals.preview.draftNote")}</p>
          {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
          <div className="flex justify-between gap-3">
            <Button variant="ghost" onClick={() => { setStep("duration"); }}>{t("admin.deals.back")}</Button>
            <Button name="activate-deal" loading={busy} onClick={() => { void activate(); }}>{t("admin.deals.activate")}</Button>
          </div>
        </div>
      ) : null}

      {step === "done" && created ? (
        <div className="flex flex-col gap-4">
          <Notice tone="success">{t("admin.deals.done", { name: created.deal.name })}</Notice>
          {created.slug ? <JoinLinkCard slug={created.slug} /> : null}
          <div className="flex justify-end">
            <Button name="close-wizard" onClick={onClose}>{t("admin.deals.close")}</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DealDrawerBody({ id, canWrite, onChanged }: { id: string; canWrite: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const reauth = useReauth();
  const detail = useResource(`/admin/growth/deals/${id}`, dealDetailSchema);
  const [failure, setFailure] = useState<unknown>(null);
  const move = async (action: "activate" | "pause" | "end") => {
    setFailure(null);
    try {
      await reauth.run(() => api(`/admin/growth/deals/${id}/${action}`, { method: "POST", body: {} }));
      toast({ tone: "success", title: t(`admin.deals.moved.${action}` as MessageKey) });
      detail.reload();
      onChanged();
    } catch (error) {
      setFailure(error);
    }
  };
  return (
    <ResourceBoundary resource={detail}>
      {(deal) => (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-heading text-xl font-bold text-text">{deal.name}</h3>
            <StatusChip kind="deal" status={deal.status} />
          </div>
          <ul className="list-disc ps-5 text-sm text-text">{termsSummary(deal.terms).map((line) => <li key={line}>{line}</li>)}</ul>
          <p className="text-sm text-text-muted">
            {t("admin.deals.usage", {
              members: formatNumber(deal.usage.membersSubject),
              orders: formatNumber(deal.usage.ordersCount),
              revenue: Object.entries(deal.usage.revenueMinor).map(([currency, minor]) => moneyText(minor, currency)).join(" · ") || "0",
            })}
          </p>
          <ul className="flex flex-col gap-1 text-sm text-text">
            {deal.targets.map((target) => (
              <li key={target.id}>{`${t(`admin.deals.target.${target.kind}` as MessageKey)}: ${target.emailDomain ?? target.orgId ?? target.userId ?? target.referralCodeId ?? ""}`}</li>
            ))}
          </ul>
          <p className="text-xs text-text-muted">{t("admin.deals.idLine", { id: deal.id })}</p>
          {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              {deal.status === "draft" || deal.status === "paused" ? <Button name="deal-activate" onClick={() => { void move("activate"); }}>{t("admin.deals.activate")}</Button> : null}
              {deal.status === "active" ? <Button variant="secondary" name="deal-pause" onClick={() => { void move("pause"); }}>{t("admin.deals.pause")}</Button> : null}
              {deal.status !== "ended" ? <Button variant="danger" name="deal-end" onClick={() => { void move("end"); }}>{t("admin.deals.end")}</Button> : null}
            </div>
          ) : null}
        </div>
      )}
    </ResourceBoundary>
  );
}

/** `/admin/growth/deals`: the deals list, its drawer and the creation wizard. */
export function GrowthDealsView({ canWrite }: { canWrite: boolean }) {
  const url = useUrlParams();
  const record = useOpenRecord();
  const [wizard, setWizard] = useState(false);
  const list = useCursorList("/admin/growth/deals", buildQuery({ status: url.get("status"), q: url.get("q") }), dealListResponseSchema);
  const columns: DataTableColumn<DealView>[] = [
    { id: "name", header: t("admin.deals.col.name"), primary: true, cell: (row) => row.name },
    { id: "status", header: t("admin.deals.col.status"), cell: (row) => <StatusChip kind="deal" status={row.status} /> },
    { id: "targets", header: t("admin.deals.col.targets"), cell: (row) => row.targets.map((target) => t(`admin.deals.target.${target.kind}` as MessageKey)).join("، ") || "—" },
    { id: "summary", header: t("admin.deals.col.summary"), cell: (row) => termsSummary(row.terms)[0] ?? "—" },
    { id: "created", header: t("admin.deals.col.created"), cell: (row) => formatDateTime(row.createdAt) },
  ];
  return (
    <div className="flex flex-col gap-5">
      {canWrite ? (
        <div>
          <Button name="new-deal" onClick={() => { setWizard(true); }}>
            <Handshake aria-hidden className="size-4" />
            {t("admin.deals.new")}
          </Button>
        </div>
      ) : null}
      <DataTable
        caption={t("admin.nav.deals")}
        columns={columns}
        rows={list.items}
        rowKey={(row) => row.id}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        onOpenRow={(row) => { record.open(row.id); }}
        openLabel={(row) => t("admin.deals.open", { name: row.name })}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        filtersActive={false}
        onClearFilters={() => undefined}
        emptyTitle={t("admin.deals.empty")}
        emptyDescription={t("admin.deals.emptyHint")}
      />
      <RecordDrawer title={t("admin.deals.detail")}>
        {(id) => <DealDrawerBody id={id} canWrite={canWrite} onChanged={list.reload} />}
      </RecordDrawer>
      <Dialog open={wizard} onOpenChange={(next) => { if (!next) setWizard(false); }} title={t("admin.deals.wizardTitle")} className="max-w-3xl">
        {wizard ? <DealWizard onClose={() => { setWizard(false); }} onCreated={list.reload} /> : null}
      </Dialog>
    </div>
  );
}
