"use client";

import { t } from "@wasfa/shared/i18n";
import {
  adminUserDetailSchema,
  adminUserRolesResponseSchema,
  type AdminRole,
  type AdminUserDetail,
} from "@wasfa/shared/schemas/admin";
import {
  Avatar,
  Badge,
  Button,
  buttonStyles,
  Field,
  Input,
  Select,
  Skeleton,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  useToast,
} from "@wasfa/ui";
import { ExternalLink, FileText, Plus, UserCheck, UserRoundX, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { formatDateTime, tOr } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { label } from "../../lib/labels";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { Code, RoleChips, UserStatusBadge } from "./badges";
import { ConfirmDialog } from "./confirm-dialog";
import { DetailList, DetailSection } from "./detail-list";
import { DetailDrawer } from "./drawer";
import { CopyableUserId, ProviderChips } from "./user-identity";

export interface UserDrawerProps {
  userId: string;
  /** The signed-in admin: nobody changes their own status or roles here (the API refuses it too). */
  meId: string;
  canSuspend: boolean;
  canWriteRoles: boolean;
  /** `users.read_health`: shows the quick link to the user's prescriptions. */
  canReadHealth: boolean;
  /** Roles the account may pick from; `null` when the list is unavailable (a role key is typed instead). */
  roles: readonly AdminRole[] | null;
  roleNames: ReadonlyMap<string, string>;
  /** Bumped by the list when a write elsewhere (the row menu) changed this user. */
  refreshSignal: number;
  onClose: () => void;
  onSuspendToggle: (user: AdminUserDetail["user"]) => void;
  /** A role was granted or revoked: the list refreshes its chips. */
  onRolesChanged: () => void;
}

type RoleChange = { kind: "grant" | "revoke"; roleKey: string };

/** The implicit `user` role has no rows: it is never granted or revoked. */
const isGrantable = (role: AdminRole) => role.key !== "user";

export function UserDrawer({
  userId,
  meId,
  canSuspend,
  canWriteRoles,
  canReadHealth,
  roles,
  roleNames,
  refreshSignal,
  onClose,
  onSuspendToggle,
  onRolesChanged,
}: UserDrawerProps) {
  const detail = useResource(`/admin/users/${userId}`, adminUserDetailSchema);
  const { reload } = detail;
  const { toast } = useToast();
  const [change, setChange] = useState<RoleChange | null>(null);

  useEffect(() => {
    if (refreshSignal > 0) reload();
  }, [refreshSignal, reload]);

  const data = detail.status === "ready" ? detail.data : null;
  const user = data?.user;
  const isSelf = user?.id === meId;
  const roleLabel = (key: string) => roleNames.get(key) ?? key;

  const confirmRoleChange = async (reason: string): Promise<void> => {
    if (!change) return;
    const path = `/admin/users/${userId}/roles/${encodeURIComponent(change.roleKey)}`;
    const result = await api(path, {
      method: change.kind === "grant" ? "PUT" : "DELETE",
      body: { reason },
      schema: adminUserRolesResponseSchema,
    });
    const done = change.kind === "grant" ? "admin.users.roleGranted" : "admin.users.roleRevoked";
    toast({
      tone: "success",
      title: t(result.changed ? done : "admin.users.roleUnchanged", {
        role: roleLabel(change.roleKey),
      }),
    });
    reload();
    onRolesChanged();
  };

  return (
    <DetailDrawer open onClose={onClose} title={user?.name ?? t("admin.users.detail")}>
      {detail.status === "loading" ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <p className="sr-only" role="status">
            {t("ui.loading")}
          </p>
          <Skeleton className="h-14 w-2/3" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-5/6" />
          <Skeleton className="h-6 w-4/6" />
        </div>
      ) : null}
      {detail.status === "error" ? (
        <ErrorNotice error={detail.error} onRetry={detail.reload} />
      ) : null}
      {data && user ? (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <Avatar name={user.name} src={user.image} size={56} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="truncate font-heading text-xl font-bold text-text">{user.name}</p>
              <div className="flex flex-wrap items-center gap-2">
                <UserStatusBadge status={user.status} />
                {user.twoFactorEnabled ? (
                  <Badge tone="success">{t("admin.users.twoFactorOn")}</Badge>
                ) : null}
              </div>
              {user.email ? (
                <bdi dir="ltr" className="truncate text-base">
                  {user.email}
                </bdi>
              ) : null}
              {user.phone ? (
                <bdi dir="ltr" className="truncate text-base">
                  {user.phone}
                </bdi>
              ) : null}
              <CopyableUserId id={user.id} />
              <ProviderChips providers={user.providers} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/admin/users/${user.id}`} className={buttonStyles()}>
                <ExternalLink aria-hidden className="size-5" />
                {t("admin.users.openProfile")}
              </Link>
              {canReadHealth ? (
                <Link href={`/admin/users/${user.id}?tab=prescriptions`} className={buttonStyles()}>
                  <FileText aria-hidden className="size-5" />
                  {t("admin.users.prescriptions")}
                </Link>
              ) : null}
            </div>
            {canSuspend && !isSelf && user.status !== "deleted" ? (
              <Button
                variant={user.status === "active" ? "secondary" : "primary"}
                name={user.status === "active" ? "suspend" : "unsuspend"}
                onClick={() => {
                  onSuspendToggle(user);
                }}
              >
                {user.status === "active" ? (
                  <UserRoundX aria-hidden className="size-5" />
                ) : (
                  <UserCheck aria-hidden className="size-5" />
                )}
                {t(user.status === "active" ? "admin.users.suspend" : "admin.users.unsuspend")}
              </Button>
            ) : null}
          </div>

          {user.status === "suspended" && user.suspendedReason ? (
            <p className="rounded-md border border-danger/30 bg-danger-soft p-3 text-base text-text">
              <span className="font-semibold text-danger">
                {t("admin.users.suspendedReason")}:{" "}
              </span>
              {user.suspendedReason}
            </p>
          ) : null}

          <Tabs defaultValue="profile">
            <TabList aria-label={t("admin.users.sections")}>
              <Tab value="profile">{t("admin.users.tab.profile")}</Tab>
              <Tab value="roles">{t("admin.users.tab.roles")}</Tab>
              <Tab value="orgs">{t("admin.users.tab.orgs")}</Tab>
              <Tab value="sessions">{t("admin.users.tab.sessions")}</Tab>
              <Tab value="activity">{t("admin.users.tab.activity")}</Tab>
            </TabList>

            <TabPanel value="profile" className="flex flex-col gap-5">
              <DetailSection title={t("admin.users.account")}>
                <DetailList
                  items={[
                    {
                      label: t("admin.users.email"),
                      value: user.email ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <bdi dir="ltr">{user.email}</bdi>
                          <Badge tone={user.emailVerified ? "success" : "neutral"}>
                            {t(user.emailVerified ? "common.verified" : "common.unverified")}
                          </Badge>
                        </span>
                      ) : null,
                    },
                    {
                      label: t("admin.users.phone"),
                      value: user.phone ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <bdi dir="ltr">{user.phone}</bdi>
                          <Badge tone={user.phoneVerified ? "success" : "neutral"}>
                            {t(user.phoneVerified ? "common.verified" : "common.unverified")}
                          </Badge>
                        </span>
                      ) : null,
                    },
                    {
                      label: t("admin.users.userId"),
                      value: <CopyableUserId id={user.id} />,
                    },
                    {
                      label: t("admin.users.providers"),
                      value: <ProviderChips providers={user.providers} />,
                    },
                    {
                      label: t("admin.users.twoFactor"),
                      value: t(
                        user.twoFactorEnabled
                          ? "admin.users.twoFactorOn"
                          : "admin.users.twoFactorOffLabel",
                      ),
                    },
                    {
                      label: t("admin.users.accountType"),
                      value: tOr(`accountType.${user.accountType}`, user.accountType),
                    },
                    { label: t("admin.users.locale"), value: label("language", user.locale) },
                    { label: t("admin.users.createdAt"), value: formatDateTime(user.createdAt) },
                    {
                      label: t("admin.users.lastLogin"),
                      value: user.lastLoginAt ? formatDateTime(user.lastLoginAt) : null,
                    },
                    {
                      label: t("admin.users.deletedAt"),
                      value: user.deletedAt ? formatDateTime(user.deletedAt) : null,
                    },
                  ]}
                />
              </DetailSection>
              <DetailSection title={t("admin.users.profile")}>
                <DetailList
                  items={[
                    { label: t("admin.users.displayName"), value: data.profile.displayName },
                    {
                      label: t("admin.users.profession"),
                      value: data.profile.profession
                        ? label("profession", data.profile.profession)
                        : null,
                    },
                    {
                      label: t("admin.users.usageIntent"),
                      value:
                        data.profile.usageIntent.length > 0
                          ? data.profile.usageIntent
                              .map((intent) => label("usageIntent", intent))
                              .join("، ")
                          : null,
                    },
                    {
                      label: t("admin.users.country"),
                      value: data.profile.country ? label("country", data.profile.country) : null,
                    },
                    { label: t("admin.users.city"), value: data.profile.city },
                  ]}
                />
              </DetailSection>
            </TabPanel>

            <TabPanel value="roles" className="flex flex-col gap-4">
              <RoleChips roles={user.roles} names={roleNames} />
              {canWriteRoles && !isSelf && user.status !== "deleted" ? (
                <>
                  {user.roles.length > 0 ? (
                    <ul className="flex flex-col gap-2">
                      {user.roles.map((roleKey) => (
                        <li
                          key={roleKey}
                          className="flex items-center justify-between gap-3 rounded-md border border-border px-3"
                        >
                          <span className="text-base">{roleLabel(roleKey)}</span>
                          <Button
                            variant="ghost"
                            name={`revoke-${roleKey}`}
                            onClick={() => {
                              setChange({ kind: "revoke", roleKey });
                            }}
                          >
                            <X aria-hidden className="size-4" />
                            {t("admin.users.revokeRole", { role: roleLabel(roleKey) })}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <GrantRole
                    held={user.roles}
                    roles={roles}
                    onGrant={(roleKey) => {
                      setChange({ kind: "grant", roleKey });
                    }}
                  />
                </>
              ) : null}
            </TabPanel>

            <TabPanel value="orgs">
              {data.organizations.length === 0 ? (
                <p className="text-base text-text-muted">{t("admin.users.noOrgs")}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {data.organizations.map((org) => (
                    <li
                      key={org.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-3"
                    >
                      <span className="font-semibold">{org.name}</span>
                      <span className="text-sm text-text-muted">
                        {label("orgType", org.type)} · {label("orgRole", org.role)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </TabPanel>

            <TabPanel value="sessions">
              {data.sessions.length === 0 ? (
                <p className="text-base text-text-muted">{t("admin.users.noSessions")}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {data.sessions.map((session) => (
                    <li key={session.id} className="flex flex-col gap-1 py-3 text-sm">
                      <span className="text-base font-semibold tabular-nums">
                        {t("admin.users.sessionLastSeen", {
                          date: formatDateTime(session.lastSeenAt),
                        })}
                      </span>
                      <span className="text-text-muted tabular-nums">
                        {t("admin.users.sessionStarted", {
                          date: formatDateTime(session.createdAt),
                        })}
                        {" · "}
                        {t("admin.users.sessionExpires", {
                          date: formatDateTime(session.expiresAt),
                        })}
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-text-muted">
                        {session.ipAddress ? <Code>{session.ipAddress}</Code> : null}
                        {session.userAgent ? (
                          <span className="truncate" dir="ltr" title={session.userAgent}>
                            {session.userAgent}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </TabPanel>

            <TabPanel value="activity">
              {data.recentAudit.length === 0 ? (
                <p className="text-base text-text-muted">{t("admin.users.noActivity")}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {data.recentAudit.map((entry) => (
                    <li key={entry.id} className="flex flex-col gap-1 py-3 text-sm">
                      <span className="flex flex-wrap items-center gap-2">
                        <Code>{entry.action}</Code>
                        <span className="text-text-muted tabular-nums">
                          {formatDateTime(entry.createdAt)}
                        </span>
                      </span>
                      <span className="text-text-muted">
                        {entry.actorName ?? t("admin.audit.system")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </TabPanel>
          </Tabs>
        </>
      ) : null}

      <ConfirmDialog
        open={change !== null}
        onOpenChange={(open) => {
          if (!open) setChange(null);
        }}
        title={
          change
            ? t(change.kind === "grant" ? "admin.users.grantTitle" : "admin.users.revokeTitle", {
                role: roleLabel(change.roleKey),
              })
            : ""
        }
        description={user ? t("admin.users.roleChangeFor", { name: user.name }) : undefined}
        confirmLabel={t(change?.kind === "revoke" ? "admin.users.revoke" : "admin.users.grant")}
        tone={change?.kind === "revoke" ? "danger" : "primary"}
        withReason
        onConfirm={confirmRoleChange}
      />
    </DetailDrawer>
  );
}

function GrantRole({
  held,
  roles,
  onGrant,
}: {
  held: readonly string[];
  roles: readonly AdminRole[] | null;
  onGrant: (roleKey: string) => void;
}) {
  const grantable = (roles ?? []).filter(isGrantable).filter((role) => !held.includes(role.key));
  const [picked, setPicked] = useState("");

  // Without the role list (no `roles.read`) the key is typed; the API rejects an unknown one.
  const usesList = roles !== null;
  if (usesList && grantable.length === 0) return null;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={t("admin.users.grantLabel")} className="min-w-0 flex-1 basis-48">
        {(control) =>
          usesList ? (
            <Select
              {...control}
              name="role"
              value={picked}
              onChange={(event) => {
                setPicked(event.target.value);
              }}
            >
              <option value="">{t("ui.select")}</option>
              {grantable.map((role) => (
                <option key={role.key} value={role.key}>
                  {role.nameAr}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              {...control}
              name="role"
              ltr
              value={picked}
              onChange={(event) => {
                setPicked(event.target.value.trim());
              }}
            />
          )
        }
      </Field>
      <Button
        name="grant"
        disabled={picked === ""}
        onClick={() => {
          onGrant(picked);
          setPicked("");
        }}
      >
        <Plus aria-hidden className="size-5" />
        {t("admin.users.grant")}
      </Button>
    </div>
  );
}
