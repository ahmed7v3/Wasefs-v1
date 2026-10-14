import { t } from "@wasfa/shared/i18n";
import { ExternalLink } from "lucide-react";

import { cn } from "../cn";

export interface SourceChip {
  url: string;
  title: string;
  domain: string;
}

export interface SourceChipsProps {
  sources: readonly SourceChip[];
  className?: string | undefined;
}

/** Only web pages can be a source; anything else (a `javascript:` URL from a confused model) is not shown. */
function isWebUrl(url: string): boolean {
  return /^https?:[/][/]/i.test(url);
}

/** Search sources as chips: domain + title, no favicon (no third-party requests), new tab, `noopener noreferrer`. */
export function SourceChips({ sources, className }: SourceChipsProps) {
  const shown = sources.filter((source) => isWebUrl(source.url));
  if (shown.length === 0) return null;
  return (
    <section aria-label={t("chat.sources.title")} className={cn("flex flex-col gap-2", className)}>
      <h4 className="m-0 text-sm font-semibold text-text-muted">{t("chat.sources.title")}</h4>
      <ul className="flex flex-wrap gap-2">
        {shown.map((source) => (
          <li key={source.url} className="min-w-0 max-w-full">
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("chat.sources.open", { title: source.title || source.domain })}
              className="flex min-h-11 max-w-full items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
            >
              <bdi dir="ltr" className="shrink-0 font-semibold text-primary">
                {source.domain}
              </bdi>
              <span className="truncate text-text-muted">{source.title}</span>
              <ExternalLink aria-hidden className="size-4 shrink-0 text-text-muted" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
