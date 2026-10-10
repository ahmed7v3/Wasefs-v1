import { cn } from "./cn";

import type { ComponentProps } from "react";

/** Placeholder block: size it (`h-6 w-40`, `size-12 rounded-full`) like the content it stands for. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-neutral-100", className)}
      {...props}
    />
  );
}
