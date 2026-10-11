import { t } from "@wasfa/shared/i18n";
import { Card, ComingSoonBadge } from "@wasfa/ui";
import { FileScan, Pill, Sparkles } from "lucide-react";

import type { MessageKey } from "@wasfa/shared/i18n";
import type { LucideIcon } from "lucide-react";

const TOOLS: ReadonlyArray<{ icon: LucideIcon; title: MessageKey; description: MessageKey }> = [
  {
    icon: FileScan,
    title: "dashboard.tool.analysis.title",
    description: "dashboard.tool.analysis.desc",
  },
  {
    icon: Sparkles,
    title: "dashboard.tool.assistant.title",
    description: "dashboard.tool.assistant.desc",
  },
  { icon: Pill, title: "dashboard.tool.drugs.title", description: "dashboard.tool.drugs.desc" },
];

/** Three equal "arrives soon" cards, in the rhythm of `3.png`: icon chip, title, one sentence, status. */
export function ToolCards() {
  return (
    <section aria-labelledby="tools-title" className="flex flex-col gap-4">
      <h2 id="tools-title" className="font-heading text-2xl font-semibold text-text">
        {t("dashboard.toolsTitle")}
      </h2>
      <ul className="grid gap-4 md:grid-cols-3">
        {TOOLS.map(({ icon: Icon, title, description }) => (
          <li key={title} className="flex">
            <Card className="flex w-full flex-col gap-3 p-5 sm:p-5">
              <span
                aria-hidden
                className="inline-flex size-12 items-center justify-center rounded-lg bg-primary-soft text-primary"
              >
                <Icon className="size-6" />
              </span>
              <h3 className="font-heading text-xl font-semibold text-text">{t(title)}</h3>
              <p className="flex-1 text-base text-text-muted">{t(description)}</p>
              <div>
                <ComingSoonBadge />
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
