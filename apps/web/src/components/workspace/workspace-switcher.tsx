"use client";

import { t } from "@wasfa/shared/i18n";
import { cn } from "@wasfa/ui";
import { Building2, Check, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { setWorkspaceOrgId } from "../../lib/workspace";

export interface WorkspaceOrg {
  id: string;
  name: string;
  role: "org_admin" | "org_member";
}

export interface WorkspaceSwitcherProps {
  organizations: readonly WorkspaceOrg[];
  /** The organization the shell currently acts for; `null` = the personal account. */
  activeOrgId: string | null;
  onChosen: () => void;
}

const itemStyles =
  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-start text-base font-semibold text-text transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus";

/** The choice of workspace inside the account menu: personal, or one of the person's organizations. */
export function WorkspaceSwitcher({
  organizations,
  activeOrgId,
  onChosen,
}: WorkspaceSwitcherProps) {
  const router = useRouter();
  if (organizations.length === 0) return null;

  const choose = (orgId: string | null) => {
    setWorkspaceOrgId(orgId);
    onChosen();
    // Server components (credits, billing) read the cookie, so they render again for the new workspace.
    router.refresh();
  };
  const active = activeOrgId ?? "personal";
  const options: Array<{ id: string; name: string; orgId: string | null }> = [
    { id: "personal", name: t("workspace.personal"), orgId: null },
    ...organizations.map((org) => ({ id: org.id, name: org.name, orgId: org.id })),
  ];
  const managed = organizations.filter((org) => org.role === "org_admin");

  return (
    <section aria-labelledby="workspace-title" className="flex flex-col gap-1">
      <h2 id="workspace-title" className="px-3 pt-1 text-sm font-semibold text-text-muted">
        {t("workspace.title")}
      </h2>
      <ul className="flex flex-col gap-1">
        {options.map((option) => {
          const selected = option.id === active;
          return (
            <li key={option.id}>
              <button
                type="button"
                aria-pressed={selected}
                className={cn(itemStyles, selected && "bg-primary-soft text-primary")}
                onClick={() => {
                  choose(option.orgId);
                }}
              >
                {option.orgId === null ? (
                  <UserRound aria-hidden className="size-5 shrink-0" />
                ) : (
                  <Building2 aria-hidden className="size-5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                {selected ? <Check aria-hidden className="size-4 shrink-0" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {managed.map((org) => (
        <Link key={org.id} href={`/org/${org.id}`} className={itemStyles} onClick={onChosen}>
          <Building2 aria-hidden className="size-5 shrink-0 text-neutral-600" />
          <span className="min-w-0 flex-1 truncate">
            {t("workspace.manage", { name: org.name })}
          </span>
        </Link>
      ))}
    </section>
  );
}
