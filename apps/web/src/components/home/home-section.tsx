import { Container, cn } from "@wasfa/ui";

import { Reveal } from "../visual/Reveal";

import type { ReactNode } from "react";

/** Soft white card of the early-access look: hairline ring, navy-tinted lift. */
export const HOME_CARD =
  "rounded-[26px] bg-white ring-1 ring-text/6 shadow-[0_1px_2px_rgb(11_18_32/0.04),0_14px_34px_-14px_rgb(30_58_138/0.18)]";

/** Navy ink button used where `buttonStyles` would sit on a dark band. */
export const HOME_FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

/**
 * One home section: the vertical rhythm and the content width are the same everywhere. Sections are
 * siblings in `page.tsx` (ad slots can sit between them), so this adds no wrapper beyond its own
 * `<section>`.
 */
export function HomeSection({
  id,
  labelledBy,
  className,
  children,
}: {
  id?: string | undefined;
  labelledBy: string;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn("relative scroll-mt-20 py-16 sm:py-24", className)}
    >
      <Container>{children}</Container>
    </section>
  );
}

/** Eyebrow, H2 and lead; revealed as one block. `dark` is for the navy bands. */
export function HomeHeading({
  id,
  eyebrow,
  title,
  lead,
  dark = false,
  align = "center",
}: {
  id: string;
  eyebrow?: string | undefined;
  title: string;
  lead?: string | undefined;
  dark?: boolean;
  align?: "center" | "start";
}) {
  return (
    <Reveal className={align === "center" ? "mx-auto max-w-reading text-center" : "max-w-xl"}>
      {eyebrow ? (
        <p className={cn("text-sm font-bold", dark ? "text-[#93c5fd]" : "text-primary")}>
          {eyebrow}
        </p>
      ) : null}
      <h2
        id={id}
        className={cn(
          "text-[clamp(1.7rem,1.1rem+2.2vw,2.6rem)] font-bold leading-[1.35]",
          eyebrow ? "mt-3" : null,
          dark ? "text-white" : "text-text",
        )}
      >
        {title}
      </h2>
      {lead ? (
        <p
          className={cn("mt-4 text-lg leading-[1.85]", dark ? "text-white/80" : "text-text-muted")}
        >
          {lead}
        </p>
      ) : null}
    </Reveal>
  );
}
