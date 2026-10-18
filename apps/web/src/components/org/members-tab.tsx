"use client";

import { t } from "@wasfa/shared/i18n";
import { memberLimitSchema, type OrgDashboard } from "@wasfa/shared/schemas/org";
import { Badge, Button, Field, Input, useToast } from "@wasfa/ui";
import { Check, Pencil, X } from "lucide-react";
import { useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { formatDate } from "../../lib/dates";
import { approveMember, rejectMember, setMemberCap } from "../../lib/org-api";
import { ErrorNotice, errorMessage } from "../error-notice";

type Member = OrgDashboard["members"][number];
type Pending = OrgDashboard["pendingMembers"][number];

export interface MembersTabProps {
  orgId: string;
  members: readonly Member[];
  pending: readonly Pending[];
  onChanged: () => void;
}

/** The monthly cap of one member: the number, or an inline field to change it. Empty = no cap. */
function CapCell({
  orgId,
  member,
  onChanged,
}: {
  orgId: string;
  member: Member;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = () => {
    setValue(member.monthlyCap === null ? "" : String(member.monthlyCap));
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const trimmed = value.trim();
    const parsed = memberLimitSchema.safeParse({
      monthlyCreditCap: trimmed === "" ? null : /^\d+$/.test(trimmed) ? Number(trimmed) : -1,
    });
    if (!parsed.success) {
      setError(t("org.members.capInvalid"));
      return;
    }
    setBusy(true);
    try {
      await setMemberCap(orgId, member.userId, parsed.data.monthlyCreditCap);
      toast({ tone: "success", title: t("org.members.capSaved", { name: member.name }) });
      setEditing(false);
      onChanged();
    } catch (failure) {
      toast({
        tone: "error",
        title: t("org.members.capFailed"),
        description: errorMessage(failure),
      });
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="tabular-nums">
          {member.monthlyCap === null ? t("org.members.noCap") : formatNumber(member.monthlyCap)}
        </span>
        <Button variant="ghost" onClick={open}>
          <Pencil aria-hidden className="size-4" />
          <span className="sr-only">{t("org.members.editCap", { name: member.name })}</span>
          <span aria-hidden className="hidden sm:inline">
            {t("org.members.edit")}
          </span>
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Field
        label={t("org.members.capLabel", { name: member.name })}
        hint={t("org.members.capHint")}
        error={error ?? undefined}
        announceError
        className="min-w-40"
      >
        {(control) => (
          <Input
            {...control}
            name="cap"
            inputMode="numeric"
            ltr
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
          />
        )}
      </Field>
      <Button type="submit" name="save-cap" loading={busy}>
        <Check aria-hidden className="size-4" />
        {t("common.save")}
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          setEditing(false);
        }}
      >
        <X aria-hidden className="size-4" />
        {t("common.cancel")}
      </Button>
    </form>
  );
}

function PendingRequests({
  orgId,
  pending,
  onChanged,
}: {
  orgId: string;
  pending: readonly Pending[];
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const decide = async (userId: string, approve: boolean) => {
    setBusyId(userId);
    setError(null);
    try {
      if (approve) await approveMember(orgId, userId);
      else await rejectMember(orgId, userId);
      toast({
        tone: "success",
        title: approve ? t("org.members.approved") : t("org.members.rejected"),
      });
      onChanged();
    } catch (failure) {
      // Shown inline: a full organization carries the upgrade link.
      setError(failure);
    } finally {
      setBusyId(null);
    }
  };

  if (pending.length === 0) return null;
  return (
    <section aria-labelledby="org-pending-title" className="flex flex-col gap-3">
      <h2 id="org-pending-title" className="font-heading text-xl font-bold text-text">
        {t("org.members.pendingTitle", { count: pending.length })}
      </h2>
      <ul className="flex flex-col divide-y divide-border/60 rounded-xl border border-border/60 bg-surface">
        {pending.map((request) => (
          <li
            key={request.userId}
            className="flex flex-wrap items-center justify-between gap-3 p-4"
            data-testid="pending-member"
          >
            <div className="flex flex-col">
              <span className="text-base font-semibold text-text">{request.name}</span>
              <span className="text-sm text-text-muted">
                {t("org.members.requestedAt", { date: formatDate(request.requestedAt) })}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                name="approve"
                loading={busyId === request.userId}
                onClick={() => {
                  void decide(request.userId, true);
                }}
              >
                {t("org.members.approve")}
                <span className="sr-only"> {request.name}</span>
              </Button>
              <Button
                variant="secondary"
                name="reject"
                disabled={busyId === request.userId}
                onClick={() => {
                  void decide(request.userId, false);
                }}
              >
                {t("org.members.reject")}
                <span className="sr-only"> {request.name}</span>
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {error ? <ErrorNotice error={error} supportHref={null} /> : null}
    </section>
  );
}

/** Members of the organization with this month's usage and cap, and the pending join requests. */
export function MembersTab({ orgId, members, pending, onChanged }: MembersTabProps) {
  return (
    <div className="flex flex-col gap-8">
      <PendingRequests orgId={orgId} pending={pending} onChanged={onChanged} />
      <section aria-labelledby="org-members-title" className="flex flex-col gap-3">
        <h2 id="org-members-title" className="font-heading text-xl font-bold text-text">
          {t("org.members.title")}
        </h2>
        <div className="overflow-x-auto rounded-xl border border-border/60 bg-surface">
          <table className="w-full min-w-xl text-start text-base">
            <caption className="sr-only">{t("org.members.caption")}</caption>
            <thead className="bg-neutral-50 text-sm text-text-muted">
              <tr>
                <th scope="col" className="p-3 text-start font-semibold">
                  {t("org.members.col.name")}
                </th>
                <th scope="col" className="p-3 text-start font-semibold">
                  {t("org.members.col.role")}
                </th>
                <th scope="col" className="p-3 text-start font-semibold">
                  {t("org.members.col.usage")}
                </th>
                <th scope="col" className="p-3 text-start font-semibold">
                  {t("org.members.col.cap")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {members.map((member) => (
                <tr key={member.userId} data-testid="member-row">
                  <th scope="row" className="p-3 text-start font-semibold text-text">
                    {member.name}
                  </th>
                  <td className="p-3">
                    <Badge tone={member.role === "org_admin" ? "info" : "neutral"}>
                      {t(`orgRole.${member.role}`)}
                    </Badge>
                  </td>
                  <td className="p-3 tabular-nums">{formatNumber(member.creditsUsed)}</td>
                  <td className="p-3">
                    <CapCell orgId={orgId} member={member} onChanged={onChanged} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
