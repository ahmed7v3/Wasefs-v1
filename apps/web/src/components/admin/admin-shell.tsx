"use client";

import { t } from "@wasfa/shared/i18n";
import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";

import { navItemFor } from "../../lib/admin-nav";
import { BrandMark } from "../brand-mark";
import { AccountMenu } from "../shell/account-menu";
import { Drawer } from "../shell/drawer";

import { AdminNav } from "./admin-nav";

import type { ReactNode } from "react";

export interface AdminShellProps {
  user: { name: string; image: string | null };
  permissions: readonly string[];
  children: ReactNode;
}

/**
 * The admin frame (DESIGN-SYSTEM §3.4 and `1.png`): a 256 px sidebar on the inline-start side (the
 * right in RTL) with the grouped navigation, a sticky 64 px top bar with the page title and the
 * account menu, and the page below. Under `lg` the sidebar is a drawer. The top bar holds the page's
 * single `h1`, taken from the navigation entry of the current path.
 */
export function AdminShell({ user, permissions, children }: AdminShellProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);
  const title = navItemFor(pathname);

  return (
    <div className="min-h-dvh bg-bg lg:flex">
      <aside className="hidden w-64 shrink-0 border-e border-border bg-surface lg:block">
        <div className="sticky top-0 flex h-dvh flex-col gap-4 overflow-y-auto p-3">
          <div className="flex min-h-16 items-center">
            <BrandMark />
          </div>
          <AdminNav permissions={permissions} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-1 sm:gap-3">
            <button
              type="button"
              onClick={() => {
                setDrawerOpen(true);
              }}
              aria-label={t("nav.open")}
              aria-expanded={drawerOpen}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-primary transition-colors duration-150 hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus lg:hidden"
            >
              <Menu aria-hidden className="size-6" />
            </button>
            <h1 className="min-w-0 truncate font-heading text-xl font-bold text-text sm:text-2xl">
              {title ? t(title.label) : t("admin.title")}
            </h1>
          </div>
          <AccountMenu {...user} />
        </header>
        <main id="main" className="min-w-0 flex-1 p-4 pb-16 sm:p-6 sm:pb-16">
          {children}
        </main>
      </div>

      <Drawer open={drawerOpen} onClose={closeDrawer} label={t("admin.nav.label")}>
        <AdminNav permissions={permissions} onNavigate={closeDrawer} />
      </Drawer>
    </div>
  );
}
