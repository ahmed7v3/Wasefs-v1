import { t } from "@wasfa/shared/i18n";
import { Badge, type BadgeTone } from "@wasfa/ui";

import { tOr } from "../../lib/admin-format";

import type { IssueStatus } from "@wasfa/shared/schemas/admin";

/*
 * Status chips of the admin tables: soft tinted backgrounds as in `1.png`, and always a text label
 * (colour is never the only signal, DESIGN-SYSTEM §5.2).
 */

const USER_TONES: Record<string, BadgeTone> = {
  active: "success",
  suspended: "danger",
  deleted: "neutral",
};

export function UserStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={USER_TONES[status] ?? "neutral"}>
      {tOr(`admin.user.status.${status}`, status)}
    </Badge>
  );
}

const ISSUE_TONES: Record<IssueStatus, BadgeTone> = {
  new: "danger",
  investigating: "warning",
  resolved: "success",
};

export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  return <Badge tone={ISSUE_TONES[status]}>{t(`admin.issue.status.${status}`)}</Badge>;
}

/** Roles of a user as small chips; `names` maps a role key to its Arabic name when the list is known. */
export function RoleChips({
  roles,
  names,
}: {
  roles: readonly string[];
  names?: ReadonlyMap<string, string> | undefined;
}) {
  if (roles.length === 0)
    return <span className="text-text-muted">{t("admin.users.noRoles")}</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {roles.map((role) => (
        <Badge key={role} tone="info" className="py-0.5">
          {names?.get(role) ?? role}
        </Badge>
      ))}
    </span>
  );
}

/** A code, id or domain shown as an LTR run inside Arabic text. */
export function Code({ children, title }: { children: string; title?: string | undefined }) {
  return (
    <bdi
      dir="ltr"
      title={title}
      className="rounded-sm bg-neutral-100 px-1.5 py-0.5 font-mono text-sm text-text wrap-anywhere"
    >
      {children}
    </bdi>
  );
}
