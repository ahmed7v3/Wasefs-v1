"use client";

import { t } from "@wasfa/shared/i18n";
import { cn } from "@wasfa/ui";
import { Menu, PanelLeft } from "lucide-react";
import { useCallback, useState } from "react";

import { useSidebarCollapsed } from "../../lib/use-sidebar-collapsed";
import { BrandMark } from "../brand-mark";

import { AccountMenu, type AccountMenuProps } from "./account-menu";
import { Drawer } from "./drawer";
import { SidebarNav } from "./sidebar-nav";

import type { ReactNode } from "react";

export interface AppShellProps {
  user: AccountMenuProps;
  /** Show the admin entry (the caller holds at least one permission; the API still decides). */
  showAdmin?: boolean;
  children: ReactNode;
}

/**
 * The signed-in frame (DESIGN-SYSTEM §3.4): a 64 px top bar over the page backdrop, then one soft
 * raised panel (like `2.png`) holding the sidebar and the page. The sidebar sits on the inline-start
 * side (right in RTL) at 256 px, or a 72 px icon rail when collapsed; below `lg` it is a drawer.
 */
export function AppShell({ user, showAdmin = false, children }: AppShellProps) {
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  return (
    <div className="page-backdrop flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between gap-3 bg-bg/80 px-3 backdrop-blur sm:px-6">
        <div className="flex items-center gap-1 sm:gap-3">
          <button
            type="button"
            onClick={() => {
              setDrawerOpen(true);
            }}
            aria-label={t("nav.open")}
            aria-expanded={drawerOpen}
            className="inline-flex size-11 items-center justify-center rounded-lg text-primary transition-colors duration-150 hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus lg:hidden"
          >
            <Menu aria-hidden className="size-6" />
          </button>
          <BrandMark />
        </div>
        <AccountMenu {...user} />
      </header>

      <div className="flex flex-1 px-3 pb-3 sm:px-6 sm:pb-6">
        <div className="flex min-w-0 flex-1 overflow-hidden rounded-2xl border border-border/50 bg-surface shadow-raised">
          <aside
            className={cn(
              "hidden shrink-0 flex-col gap-4 border-e border-border/60 p-3 lg:flex",
              collapsed ? "w-18" : "w-64",
            )}
          >
            <SidebarNav collapsed={collapsed} showAdmin={showAdmin} />
            <button
              type="button"
              onClick={() => {
                setCollapsed(!collapsed);
              }}
              aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
              className={cn(
                "mt-auto inline-flex min-h-11 items-center gap-3 rounded-lg px-3 text-base font-semibold text-text-muted transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus",
                collapsed && "justify-center",
              )}
            >
              {/* The panel icon mirrors with the layout (DESIGN-SYSTEM §4.4). */}
              <PanelLeft aria-hidden className="size-5 shrink-0 rtl:-scale-x-100" />
              <span className={cn(collapsed && "sr-only")}>
                {collapsed ? t("nav.expand") : t("nav.collapse")}
              </span>
            </button>
          </aside>
          <main id="main" className="min-w-0 flex-1 p-5 pb-24 sm:p-8 sm:pb-24">
            {children}
          </main>
        </div>
      </div>

      <Drawer open={drawerOpen} onClose={closeDrawer} label={t("nav.main")}>
        <SidebarNav onNavigate={closeDrawer} showAdmin={showAdmin} />
      </Drawer>
    </div>
  );
}
