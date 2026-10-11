"use client";

import { AI_MODES, type AiMode, type AiTask } from "@wasfa/shared/ai";
import { t } from "@wasfa/shared/i18n";
import { RX_MAX_PAGES } from "@wasfa/shared/rx";
import { planViewSchema, type PlanView } from "@wasfa/shared/schemas/plans";
import { Button, Card, Checkbox, Input, useToast } from "@wasfa/ui";
import { useState } from "react";

import { isRxTask, modeLabel, taskLabel } from "../../lib/admin-billing";
import { api } from "../../lib/api-client";
import {
  draftEntitlements,
  validateEntitlements,
  type EntitlementDraft,
} from "../../lib/entitlement-draft";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";

import type { ApiRequestError } from "../../lib/api-error";
import type { FormEvent } from "react";

export interface EntitlementsEditorProps {
  plan: PlanView;
  canWrite: boolean;
  onSaved: () => void;
}

const head =
  "h-12 border-b border-border bg-neutral-50 px-3 text-start text-sm font-semibold text-text-muted";
const cell = "border-b border-border px-3 align-middle";

/**
 * What a plan may use, one row per task (Decision 2): allowed, which modes, daily and monthly caps
 * (empty = unlimited), the page limit of a prescription and web search. The whole set is replaced on
 * save. The table scrolls inside its card so a phone never scrolls sideways.
 */
export function EntitlementsEditor({ plan, canWrite, onSaved }: EntitlementsEditorProps) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [rows, setRows] = useState<EntitlementDraft[]>(() => draftEntitlements(plan.entitlements));
  const [errors, setErrors] = useState<Partial<Record<AiTask, string>>>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const patch = (task: AiTask, change: Partial<EntitlementDraft>) => {
    setRows((current) => current.map((row) => (row.task === task ? { ...row, ...change } : row)));
    setErrors((current) => {
      if (!Object.hasOwn(current, task)) return current;
      return Object.fromEntries(Object.entries(current).filter(([name]) => name !== task));
    });
  };

  const toggleMode = (row: EntitlementDraft, mode: AiMode, on: boolean) => {
    patch(row.task, {
      modes: on ? [...row.modes, mode] : row.modes.filter((entry) => entry !== mode),
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !canWrite) return;
    const checked = validateEntitlements(rows);
    if (!checked.body) {
      setErrors(checked.errors);
      setFormError(null);
      return;
    }
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    const body = checked.body;
    reauth
      .run(() =>
        api(`/admin/plans/${plan.id}/entitlements`, {
          method: "PUT",
          body,
          schema: planViewSchema,
        }),
      )
      .then(
        () => {
          toast({ tone: "success", title: t("admin.plans.ent.saved", { name: plan.nameAr }) });
          onSaved();
        },
        (error: unknown) => {
          setSubmitting(false);
          setFormError(toApiError(error));
        },
      );
  };

  const readOnly = !canWrite;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="text-base text-text-muted">
        {readOnly ? t("admin.plans.ent.readOnly") : t("admin.plans.ent.lead")}
      </p>
      <Card elevation="flat" padding="none" className="overflow-x-auto">
        <table className="w-full min-w-[52rem] border-separate border-spacing-0 text-start text-base">
          <caption className="sr-only">
            {t("admin.plans.ent.caption", { name: plan.nameAr })}
          </caption>
          <thead>
            <tr>
              <th scope="col" className={head}>
                {t("admin.plans.ent.col.task")}
              </th>
              <th scope="col" className={head}>
                {t("admin.plans.ent.col.allowed")}
              </th>
              <th scope="col" className={head}>
                {t("admin.plans.ent.col.modes")}
              </th>
              <th scope="col" className={head}>
                {t("admin.plans.ent.col.dailyCap")}
              </th>
              <th scope="col" className={head}>
                {t("admin.plans.ent.col.monthlyCap")}
              </th>
              <th scope="col" className={head}>
                {t("admin.plans.ent.col.maxPages")}
              </th>
              <th scope="col" className={head}>
                {t("admin.plans.ent.col.webSearch")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const task = taskLabel(row.task);
              const off = readOnly || !row.allowed;
              const error = errors[row.task];
              return (
                <tr key={row.task}>
                  <th scope="row" className={`${cell} py-2 text-start font-semibold`}>
                    {task}
                    {error ? (
                      <span role="alert" className="mt-1 block text-sm font-normal text-danger">
                        {error}
                      </span>
                    ) : null}
                  </th>
                  <td className={cell}>
                    <Checkbox
                      name={`${row.task}-allowed`}
                      label={
                        <span className="sr-only">{t("admin.plans.ent.allowedFor", { task })}</span>
                      }
                      checked={row.allowed}
                      disabled={readOnly}
                      onChange={(event) => {
                        patch(row.task, { allowed: event.target.checked });
                      }}
                    />
                  </td>
                  <td className={cell}>
                    <div className="flex items-center gap-3">
                      {AI_MODES.map((mode) => (
                        <Checkbox
                          key={mode}
                          name={`${row.task}-mode-${mode}`}
                          label={modeLabel(mode)}
                          aria-label={t("admin.plans.ent.modeFor", { task, mode: modeLabel(mode) })}
                          checked={row.modes.includes(mode)}
                          disabled={off}
                          onChange={(event) => {
                            toggleMode(row, mode, event.target.checked);
                          }}
                        />
                      ))}
                    </div>
                  </td>
                  <td className={cell}>
                    <Input
                      name={`${row.task}-dailyCap`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      ltr
                      className="min-w-28"
                      placeholder={t("admin.plans.ent.unlimited")}
                      aria-label={t("admin.plans.ent.dailyCapFor", { task })}
                      value={row.dailyCap}
                      disabled={off}
                      onChange={(event) => {
                        patch(row.task, { dailyCap: event.target.value });
                      }}
                    />
                  </td>
                  <td className={cell}>
                    <Input
                      name={`${row.task}-monthlyCap`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      ltr
                      className="min-w-28"
                      placeholder={t("admin.plans.ent.unlimited")}
                      aria-label={t("admin.plans.ent.monthlyCapFor", { task })}
                      value={row.monthlyCap}
                      disabled={off}
                      onChange={(event) => {
                        patch(row.task, { monthlyCap: event.target.value });
                      }}
                    />
                  </td>
                  <td className={cell}>
                    {isRxTask(row.task) ? (
                      <Input
                        name={`${row.task}-maxPages`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={RX_MAX_PAGES}
                        ltr
                        className="min-w-24"
                        aria-label={t("admin.plans.ent.maxPagesFor", { task })}
                        value={row.maxPages}
                        disabled={off}
                        onChange={(event) => {
                          patch(row.task, { maxPages: event.target.value });
                        }}
                      />
                    ) : (
                      <span aria-hidden className="text-text-muted">
                        —
                      </span>
                    )}
                  </td>
                  <td className={cell}>
                    <Checkbox
                      name={`${row.task}-webSearch`}
                      label={
                        <span className="sr-only">
                          {t("admin.plans.ent.webSearchFor", { task })}
                        </span>
                      }
                      checked={row.webSearch}
                      disabled={off}
                      onChange={(event) => {
                        patch(row.task, { webSearch: event.target.checked });
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {formError ? <ErrorNotice error={formError} /> : null}
      {readOnly ? null : (
        <div className="flex justify-end">
          <Button type="submit" name="save" loading={submitting}>
            {t("common.save")}
          </Button>
        </div>
      )}
    </form>
  );
}
