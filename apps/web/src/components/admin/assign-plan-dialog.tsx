"use client";

import { t } from "@wasfa/shared/i18n";
import { adminUserListResponseSchema, type AdminUser } from "@wasfa/shared/schemas/admin";
import { WALLET_OWNER_TYPES, type WalletOwnerType } from "@wasfa/shared/schemas/credits";
import { assignPlanSchema, planAssignmentSchema, type PlanView } from "@wasfa/shared/schemas/plans";
import { Button, Dialog, Field, Input, Select, Spinner, Textarea, useToast } from "@wasfa/ui";
import { useEffect, useState } from "react";

import { ownerTypeLabel } from "../../lib/admin-billing";
import { dayBoundary } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { ApiRequestError } from "../../lib/api-error";
import { serverFieldErrors, toApiError, validateValues } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";

import type { FormEvent } from "react";

export const USER_SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;

export interface AssignPlanDialogProps {
  open: boolean;
  plans: readonly PlanView[];
  /** `users.read`: a user can be found by name or email instead of pasting the id. */
  canSearchUsers: boolean;
  onClose: () => void;
  onAssigned: () => void;
}

/** Search box over `GET /admin/users?q=`: choosing a result fills the owner id. */
function UserSearch({ onPick }: { onPick: (user: AdminUser) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminUser[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const text = query.trim();
    if (text.length < MIN_SEARCH_LENGTH) {
      setResults(null);
      setSearching(false);
      setFailed(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      setFailed(false);
      api(`/admin/users?q=${encodeURIComponent(text)}&limit=5`, {
        schema: adminUserListResponseSchema,
        signal: controller.signal,
      }).then(
        (page) => {
          setResults(page.items);
          setSearching(false);
        },
        () => {
          if (controller.signal.aborted) return;
          setFailed(true);
          setSearching(false);
        },
      );
    }, USER_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <div className="flex flex-col gap-2">
      <Field label={t("admin.plans.assign.search")} hint={t("admin.plans.assign.searchHint")}>
        {(control) => (
          <Input
            {...control}
            name="user-search"
            type="search"
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        )}
      </Field>
      <div aria-live="polite" className="text-sm text-text-muted">
        {searching ? (
          <span className="inline-flex items-center gap-2">
            <Spinner decorative />
            {t("ui.loading")}
          </span>
        ) : failed ? (
          t("admin.plans.assign.searchFailed")
        ) : results && results.length === 0 ? (
          t("admin.plans.assign.noResults")
        ) : null}
      </div>
      {results && results.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {results.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(user);
                  setQuery("");
                }}
                className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-start hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
              >
                <span className="font-semibold">{user.name}</span>
                <span dir="ltr" className="text-sm text-text-muted">
                  {user.email ?? user.phone ?? user.id}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AssignForm({ plans, canSearchUsers, onClose, onAssigned }: AssignPlanDialogProps) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [ownerType, setOwnerType] = useState<WalletOwnerType>("user");
  const [ownerId, setOwnerId] = useState("");
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [planId, setPlanId] = useState("");
  const [endDay, setEndDay] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const endsAt = dayBoundary(endDay, "end");
    const values = {
      owner: { type: ownerType, id: ownerId.trim() },
      planId,
      ...(endsAt ? { endsAt } : {}),
      reason,
    };
    const invalid = validateValues(assignPlanSchema, values);
    if (invalid["endsAt"]) invalid["endsAt"] = t("admin.plans.assign.endsInPast");
    if (Object.keys(invalid).length > 0) {
      setErrors(invalid);
      setFormError(null);
      setSubmitCount((count) => count + 1);
      return;
    }
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    reauth
      .run(() =>
        api("/admin/plans/assignments", {
          method: "POST",
          body: values,
          schema: planAssignmentSchema,
        }),
      )
      .then(
        () => {
          toast({ tone: "success", title: t("admin.plans.assign.done") });
          onAssigned();
          onClose();
        },
        (error: unknown) => {
          setSubmitting(false);
          if (error instanceof ApiRequestError && error.code === "NOT_FOUND") {
            setErrors({ "owner.id": t("admin.plans.assign.ownerNotFound") });
            setSubmitCount((count) => count + 1);
            return;
          }
          const mapped = serverFieldErrors(error, assignPlanSchema, values, [
            "owner.id",
            "planId",
            "endsAt",
            "reason",
          ]);
          if (mapped) {
            setErrors(mapped);
            setSubmitCount((count) => count + 1);
          } else {
            setFormError(toApiError(error));
          }
        },
      );
  };

  const announce = submitCount > 0;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label={t("admin.plans.assign.ownerType")}>
        {(control) => (
          <Select
            {...control}
            name="ownerType"
            value={ownerType}
            onChange={(event) => {
              setOwnerType(event.target.value === "org" ? "org" : "user");
              setPickedName(null);
            }}
          >
            {WALLET_OWNER_TYPES.map((type) => (
              <option key={type} value={type}>
                {ownerTypeLabel(type)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {canSearchUsers && ownerType === "user" ? (
        <UserSearch
          onPick={(user) => {
            setOwnerId(user.id);
            setPickedName(user.name);
          }}
        />
      ) : null}
      <Field
        label={t("admin.plans.assign.ownerId")}
        hint={
          pickedName
            ? t("admin.plans.assign.picked", { name: pickedName })
            : t("admin.plans.assign.ownerIdHint")
        }
        required
        error={errors["owner.id"]}
        announceError={announce}
      >
        {(control) => (
          <Input
            {...control}
            name="ownerId"
            ltr
            autoComplete="off"
            value={ownerId}
            onChange={(event) => {
              setOwnerId(event.target.value);
              setPickedName(null);
            }}
          />
        )}
      </Field>
      <Field
        label={t("admin.plans.assign.plan")}
        required
        error={errors["planId"]}
        announceError={announce}
      >
        {(control) => (
          <Select
            {...control}
            name="planId"
            value={planId}
            onChange={(event) => {
              setPlanId(event.target.value);
            }}
          >
            <option value="">{t("admin.plans.assign.pickPlan")}</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.nameAr} ({plan.key})
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label={t("admin.plans.assign.endsAt")}
        hint={t("admin.plans.assign.endsAtHint")}
        error={errors["endsAt"]}
        announceError={announce}
      >
        {(control) => (
          <Input
            {...control}
            name="endsAt"
            type="date"
            ltr
            value={endDay}
            onChange={(event) => {
              setEndDay(event.target.value);
            }}
          />
        )}
      </Field>
      <Field
        label={t("admin.reason.label")}
        hint={t("admin.reason.hint")}
        required
        error={errors["reason"]}
        announceError={announce}
      >
        {(control) => (
          <Textarea
            {...control}
            name="reason"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        )}
      </Field>
      {formError ? <ErrorNotice error={formError} /> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" name="cancel" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" name="assign" loading={submitting}>
          {t("admin.plans.assign.submit")}
        </Button>
      </div>
    </form>
  );
}

/** Assign a plan to a user or an organization by hand (Phase 2; subscriptions replace this in Phase 3). */
export function AssignPlanDialog(props: AssignPlanDialogProps) {
  const { open, onClose } = props;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("admin.plans.assign.title")}
      description={t("admin.plans.assign.lead")}
    >
      {open ? <AssignForm {...props} /> : null}
    </Dialog>
  );
}
