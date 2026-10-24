import { cn } from "@wasfa/ui";

export interface SectionHeadingProps {
  id: string;
  title: string;
  lead?: string | undefined;
  /** Small label above the title (the section's name in the page's rhythm). */
  eyebrow?: string | undefined;
  /** `inverse` is for the dark navy band. */
  tone?: "default" | "inverse";
  className?: string | undefined;
}

/**
 * H2, optional eyebrow and lead of a landing section, centred. The id is the heading's, so
 * `aria-labelledby` can use it. The short accent underline grows with scroll where supported.
 */
export function SectionHeading({
  id,
  title,
  lead,
  eyebrow,
  tone = "default",
  className,
}: SectionHeadingProps) {
  const inverse = tone === "inverse";
  return (
    <div className={cn("mx-auto max-w-reading text-center", className)}>
      {eyebrow ? (
        <p
          className={cn(
            "inline-flex rounded-full border px-3 py-0.5 text-sm font-bold",
            inverse
              ? "border-white/25 bg-white/10 text-white"
              : "border-border bg-surface text-primary",
          )}
        >
          {eyebrow}
        </p>
      ) : null}
      <h2
        id={id}
        className={cn(
          "motion-underline text-2xl font-bold sm:text-4xl",
          eyebrow ? "mt-4" : null,
          inverse ? "text-white [--heading-underline:var(--color-accent)]" : "text-text",
        )}
      >
        {title}
      </h2>
      {lead ? (
        <p className={cn("mt-3 text-lg", inverse ? "text-white/85" : "text-text-muted")}>{lead}</p>
      ) : null}
    </div>
  );
}
