import { t, type MessageKey } from "@wasfa/shared/i18n";
import { Card } from "@wasfa/ui";
import {
  Calculator,
  FileScan,
  FlaskConical,
  GitCompareArrows,
  Pill,
  ScanSearch,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import type { ChatSkill } from "@wasfa/shared/schemas/chat";

interface Tool {
  id: "rx" | ChatSkill;
  icon: LucideIcon;
  title: MessageKey;
  description: MessageKey;
  /** The prescription analysis has its own page; the others open the assistant with the skill chosen. */
  href: string;
}

const TOOLS: readonly Tool[] = [
  {
    id: "rx",
    icon: FileScan,
    title: "dashboard.tools.rx.title",
    description: "dashboard.tools.rx.desc",
    href: "/analyze",
  },
  {
    id: "drug-info",
    icon: Pill,
    title: "dashboard.tools.drug-info.title",
    description: "dashboard.tools.drug-info.desc",
    href: "/ai?skill=drug-info",
  },
  {
    id: "lab-test-interpretation",
    icon: FlaskConical,
    title: "dashboard.tools.lab-test-interpretation.title",
    description: "dashboard.tools.lab-test-interpretation.desc",
    href: "/ai?skill=lab-test-interpretation",
  },
  {
    id: "imaging-educational",
    icon: ScanSearch,
    title: "dashboard.tools.imaging-educational.title",
    description: "dashboard.tools.imaging-educational.desc",
    href: "/ai?skill=imaging-educational",
  },
  {
    id: "dose-calculator",
    icon: Calculator,
    title: "dashboard.tools.dose-calculator.title",
    description: "dashboard.tools.dose-calculator.desc",
    href: "/ai?skill=dose-calculator",
  },
  {
    id: "drug-interaction-check",
    icon: GitCompareArrows,
    title: "dashboard.tools.drug-interaction-check.title",
    description: "dashboard.tools.drug-interaction-check.desc",
    href: "/ai?skill=drug-interaction-check",
  },
];

/**
 * The six tools, all live: prescription analysis opens `/analyze`, the five assistant skills open
 * `/ai` with the skill chosen. Each card is one link (44 px+ target, one tab stop).
 */
export function ToolCards() {
  return (
    <section aria-labelledby="tools-title" className="flex flex-col gap-3 sm:gap-4">
      <h2 id="tools-title" className="font-heading text-xl font-semibold text-text sm:text-2xl">
        {t("dashboard.tools.title")}
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {TOOLS.map(({ id, icon: Icon, title, description, href }) => (
          <li key={id} className="flex">
            <Card padding="none" className="flex w-full overflow-hidden">
              <Link
                href={href}
                className="flex min-h-11 w-full flex-col gap-2 p-3 transition-colors sm:gap-3 sm:p-5 duration-150 hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
              >
                <span
                  aria-hidden
                  className="inline-flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary sm:size-12"
                >
                  <Icon className="size-5 sm:size-6" />
                </span>
                <h3 className="font-heading text-base font-semibold leading-snug text-text sm:text-xl">
                  {t(title)}
                </h3>
                <p className="line-clamp-3 text-sm text-text-muted sm:text-base">
                  {t(description)}
                </p>
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
