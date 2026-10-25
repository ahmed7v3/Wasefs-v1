"use client";

import { useState } from "react";

/**
 * The only client island of the content pages: copies the page URL. Without JS the share links remain.
 * The labels come from the server component: importing the message catalogue here would ship all of it
 * (about 37 KB gzip) to every content page for two strings.
 */
export function CopyLinkButton({
  url,
  label,
  copiedLabel,
}: {
  url: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access can be denied (insecure context, permissions): the share links still work.
      setCopied(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-base font-semibold text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus"
      >
        {label}
      </button>
      <span role="status" className="text-sm text-text-muted">
        {copied ? copiedLabel : ""}
      </span>
    </>
  );
}
