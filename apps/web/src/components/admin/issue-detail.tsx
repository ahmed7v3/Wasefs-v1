"use client";

import { ERROR_INFO, isErrorCode } from "@wasfa/shared/errors";
import { t } from "@wasfa/shared/i18n";
import {
  ISSUE_STATUSES,
  issueDetailSchema,
  issueSchema,
  type IssueStatus,
} from "@wasfa/shared/schemas/admin";
import {
  Button,
  Card,
  CardTitle,
  Field,
  Select,
  Skeleton,
  buttonStyles,
  useToast,
} from "@wasfa/ui";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { formatDateTime, formatNumber, tOr } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice, errorMessage } from "../error-notice";

import { Code, IssueStatusBadge } from "./badges";
import { DetailList, DetailSection } from "./detail-list";
import { JsonView } from "./json-view";

export interface IssueDetailProps {
  fingerprint: string;
  canWrite: boolean;
  /** `users.read`: the affected user's id then links to the users list. */
  canReadUsers: boolean;
}

/** A plain-language reason for an error code, for the person reading the issue. */
function explanation(code: string): string {
  return tOr(`admin.issue.explain.${code}`, t("admin.issue.explain.unknown"));
}

function StatusEditor({
  fingerprint,
  status,
  onChanged,
}: {
  fingerprint: string;
  status: IssueStatus;
  onChanged: () => void;
}) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [next, setNext] = useState<IssueStatus>(status);
  const [saving, setSaving] = useState(false);

  const save = () => {
    setSaving(true);
    reauth
      .run(() =>
        api(`/admin/issues/${fingerprint}`, {
          method: "PATCH",
          body: { status: next },
          schema: issueSchema,
        }),
      )
      .then(
        () => {
          toast({
            tone: "success",
            title: t("admin.issue.statusSaved", { status: t(`admin.issue.status.${next}`) }),
          });
          onChanged();
        },
        (error: unknown) => {
          toast({ tone: "error", title: errorMessage(error) });
        },
      )
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={t("admin.issue.statusLabel")} className="min-w-0 basis-52">
        {(control) => (
          <Select
            {...control}
            name="status"
            value={next}
            onChange={(event) => {
              setNext(event.target.value as IssueStatus);
            }}
          >
            {ISSUE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`admin.issue.status.${status}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Button name="save-status" onClick={save} loading={saving} disabled={next === status}>
        {t("admin.issue.saveStatus")}
      </Button>
    </div>
  );
}

export function IssueDetail({ fingerprint, canWrite, canReadUsers }: IssueDetailProps) {
  const detail = useResource(`/admin/issues/${fingerprint}`, issueDetailSchema);

  const back = (
    <Link href="/admin/issues" className={buttonStyles({ variant: "ghost", className: "w-fit" })}>
      <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
      {t("admin.issue.back")}
    </Link>
  );

  if (detail.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        {back}
        <p className="sr-only" role="status">
          {t("ui.loading")}
        </p>
        <Card elevation="flat" className="flex flex-col gap-3">
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-2/3" />
        </Card>
      </div>
    );
  }
  if (detail.status === "error") {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <ErrorNotice error={detail.error} onRetry={detail.reload} />
      </div>
    );
  }

  const issue = detail.data;
  const known = isErrorCode(issue.code) ? ERROR_INFO[issue.code].message.ar : null;

  return (
    <div className="flex flex-col gap-5">
      {back}
      <Card elevation="flat" padding="compact" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle>
            <Code>{issue.code}</Code>
          </CardTitle>
          <IssueStatusBadge status={issue.status} />
        </div>
        <p className="text-base text-text">{explanation(issue.code)}</p>
        {known ? (
          <p className="text-sm text-text-muted">{t("admin.issue.userSees", { message: known })}</p>
        ) : null}

        <DetailList
          items={[
            {
              label: t("admin.issues.col.route"),
              value: issue.route ? (
                <Code>{`${issue.method ?? ""} ${issue.route}`.trim()}</Code>
              ) : null,
            },
            { label: t("admin.issue.message"), value: issue.message },
            { label: t("admin.issues.col.count"), value: formatNumber(issue.count) },
            { label: t("admin.issues.col.users"), value: formatNumber(issue.affectedUsers) },
            { label: t("admin.issues.col.firstSeen"), value: formatDateTime(issue.firstSeen) },
            { label: t("admin.issues.col.lastSeen"), value: formatDateTime(issue.lastSeen) },
            { label: t("admin.issue.sampleRef"), value: <Code>{issue.sampleRef}</Code> },
          ]}
        />

        {canWrite ? (
          <StatusEditor
            key={issue.status}
            fingerprint={fingerprint}
            status={issue.status}
            onChanged={detail.reload}
          />
        ) : null}
      </Card>

      <DetailSection title={t("admin.issue.events")}>
        {issue.events.length === 0 ? (
          <p className="text-base text-text-muted">{t("admin.issue.noEvents")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {issue.events.map((event) => (
              <li key={event.ref}>
                <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <Code>{event.ref}</Code>
                    <span className="text-text-muted tabular-nums">
                      {formatDateTime(event.createdAt)}
                    </span>
                    {event.userId ? (
                      canReadUsers ? (
                        <Link
                          href={`/admin/users?user=${event.userId}`}
                          className="rounded-sm text-primary underline focus-visible:outline-none focus-visible:shadow-focus"
                        >
                          {t("admin.issue.viewUser")}
                        </Link>
                      ) : (
                        <Code>{event.userId}</Code>
                      )
                    ) : null}
                    {event.requestId ? (
                      <Code title={t("admin.issue.requestId")}>{event.requestId}</Code>
                    ) : null}
                  </div>
                  <JsonView
                    value={event.context}
                    label={`${t("admin.issue.context")} ${event.ref}`}
                  />
                  {event.stack ? (
                    <details>
                      <summary className="cursor-pointer text-sm font-semibold text-primary">
                        {t("admin.issue.stack")}
                      </summary>
                      <pre
                        dir="ltr"
                        tabIndex={0}
                        className="mt-2 max-h-80 overflow-auto rounded-md border border-border bg-surface p-3 text-start font-mono text-sm"
                      >
                        {event.stack}
                      </pre>
                    </details>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </DetailSection>
    </div>
  );
}
