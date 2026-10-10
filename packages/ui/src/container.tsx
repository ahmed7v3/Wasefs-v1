import { cn } from "./cn";

import type { HTMLAttributes } from "react";

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** `reading` is a narrow reading column. */
  width?: "page" | "reading";
}

/** Centred page column with responsive gutters (logical `px`, so RTL needs no overrides). */
export function Container({ width = "page", className, ...props }: ContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-gutter sm:px-gutter-lg",
        width === "page" ? "max-w-page" : "max-w-reading",
        className,
      )}
      {...props}
    />
  );
}
