"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { cn } from "@wasfa/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: ReadonlyArray<{ href: string; label: MessageKey }> = [
  { href: "/account", label: "account.nav.profile" },
  { href: "/account/security", label: "account.nav.security" },
  { href: "/account/delete", label: "account.nav.delete" },
];

/**
 * Sub-navigation of the account area. These are separate pages, so they are links with
 * `aria-current`, styled like the `Tabs` underline (not the `Tabs` component, which is for panels).
 */
export function AccountNav() {
  const pathname = usePathname();
  return (
    <nav aria-label={t("account.nav.label")} className="mb-6 border-b border-border">
      <ul className="flex flex-wrap gap-x-1">
        {LINKS.map(({ href, label }) => {
          const active = pathname === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-base font-semibold transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:shadow-focus",
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-text-muted hover:text-text",
                )}
              >
                {t(label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
