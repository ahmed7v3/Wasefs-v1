"use client";

import { t } from "@wasfa/shared/i18n";
import { ANONYMIZED_USER_NAME } from "@wasfa/shared/identity";
import { Avatar, useToast } from "@wasfa/ui";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { displayName } from "../../lib/labels";
import { PopoverMenu } from "../popover-menu";

const itemStyles =
  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-start text-base font-semibold text-text transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus";

export interface AccountMenuProps {
  name: string;
  image: string | null;
}

export function AccountMenu({ name, image }: AccountMenuProps) {
  const { toast } = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const shownName = displayName(name, ANONYMIZED_USER_NAME);

  const signOut = () => {
    if (signingOut) return;
    setSigningOut(true);
    api("/auth/sign-out", { method: "POST" })
      .then(() => {
        // A full navigation, so nothing of the signed-in page survives in memory.
        window.location.assign("/login");
      })
      .catch(() => {
        setSigningOut(false);
        toast({ tone: "error", title: t("shell.signOutFailed") });
      });
  };

  return (
    <PopoverMenu
      // The name is part of the label: a visible name must be contained in the accessible name (WCAG 2.5.3).
      label={`${shownName} - ${t("shell.accountMenu")}`}
      triggerClassName="inline-flex min-h-11 items-center gap-2 rounded-full bg-surface ps-1 pe-3 shadow-card transition-colors duration-150 hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
      trigger={
        <>
          <Avatar name={shownName} src={image} size={40} />
          <span
            className="hidden max-w-40 truncate text-base font-semibold text-text sm:inline"
            title={shownName}
          >
            {shownName}
          </span>
          <ChevronDown aria-hidden className="size-4 text-neutral-600" />
        </>
      }
    >
      {(close) => (
        <ul className="flex flex-col gap-1">
          <li>
            <Link href="/account" className={itemStyles} onClick={close}>
              <UserRound aria-hidden className="size-5 text-neutral-600" />
              {t("nav.account")}
            </Link>
          </li>
          <li>
            <button type="button" className={itemStyles} onClick={signOut} disabled={signingOut}>
              <LogOut aria-hidden className="size-5 text-neutral-600 rtl:-scale-x-100" />
              {t("shell.signOut")}
            </button>
          </li>
        </ul>
      )}
    </PopoverMenu>
  );
}
