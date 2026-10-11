import { cn } from "@wasfa/ui";

export interface SectionHeadingProps {
  id: string;
  title: string;
  lead?: string | undefined;
  className?: string | undefined;
}

/** H2 and optional lead of a landing section, centred. The id is the heading's, so `aria-labelledby` can use it. */
export function SectionHeading({ id, title, lead, className }: SectionHeadingProps) {
  return (
    <div className={cn("mx-auto max-w-reading text-center", className)}>
      <h2 id={id} className="font-heading text-2xl font-semibold text-text sm:text-3xl">
        {title}
      </h2>
      {lead ? <p className="mt-3 text-lg text-text-muted">{lead}</p> : null}
    </div>
  );
}
