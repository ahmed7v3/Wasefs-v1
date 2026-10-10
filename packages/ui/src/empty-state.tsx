import { Inbox } from "lucide-react";

import { cn } from "./cn";

import type { ComponentProps, ReactNode } from "react";

export interface EmptyStateProps extends Omit<ComponentProps<"div">, "title"> {
  /** What is empty, in one line. */
  title: ReactNode;
  /** One sentence: why, or what to do next. */
  description?: ReactNode;
  /** Decorative icon (it is hidden from assistive tech); defaults to an inbox. */
  icon?: ReactNode;
  /** At most one primary action (a Button or a link styled with `buttonStyles`). */
  action?: ReactNode;
  /** Heading level of the title, to keep headings in order on the page. */
  titleAs?: "h2" | "h3" | undefined;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  titleAs: Title = "h2",
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center gap-3 px-4 py-10 text-center", className)}
      {...props}
    >
      <span
        aria-hidden
        className="inline-flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary [&>svg]:size-7"
      >
        {icon ?? <Inbox />}
      </span>
      <Title className="font-heading text-xl font-semibold text-text">{title}</Title>
      {description ? <p className="max-w-prose text-base text-text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
