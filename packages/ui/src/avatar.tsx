"use client";

import { useState } from "react";

import { cn } from "./cn";

import type { ComponentProps } from "react";

export type AvatarSize = 32 | 40 | 56;

const sizes: Record<AvatarSize, string> = {
  32: "size-8 text-sm",
  40: "size-10 text-base",
  56: "size-14 text-xl",
};

/** First letters of the first two words (works for Arabic and Latin); "?" when the name is empty. */
export function getInitials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "");
  const initials = letters.join("").toLocaleUpperCase();
  return initials || "?";
}

export interface AvatarProps extends Omit<ComponentProps<"span">, "children"> {
  /** Used for the initials and as the accessible name. */
  name: string;
  src?: string | null | undefined;
  size?: AvatarSize | undefined;
}

export function Avatar({ name, src, size = 40, className, ...props }: AvatarProps) {
  // Remember which URL failed so a new `src` gets a fresh attempt.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-primary-soft font-semibold text-primary",
        sizes[size],
        className,
      )}
      {...props}
    >
      {showImage && src ? (
        <img
          src={src}
          alt={name}
          width={size}
          height={size}
          loading="lazy"
          className="size-full object-cover"
          onError={() => {
            setFailedSrc(src);
          }}
        />
      ) : (
        <span role="img" aria-label={name}>
          <span aria-hidden>{getInitials(name)}</span>
        </span>
      )}
    </span>
  );
}
