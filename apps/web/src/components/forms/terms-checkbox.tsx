"use client";

import { t } from "@wasfa/shared/i18n";
import { Checkbox } from "@wasfa/ui";
import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { useId } from "react";

import type { ChangeEvent } from "react";

export interface TermsCheckboxProps {
  name: string;
  checked: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  error?: string | undefined;
  announceError?: boolean | undefined;
}

/** "I agree to the terms and privacy policy": required, enforced in the browser only (the API has no such field). */
export function TermsCheckbox({
  name,
  checked,
  onChange,
  error,
  announceError,
}: TermsCheckboxProps) {
  const errorId = useId();
  const link = "font-semibold text-primary underline underline-offset-2";
  return (
    <div className="flex flex-col gap-1.5">
      <Checkbox
        name={name}
        checked={checked}
        onChange={onChange}
        required
        invalid={error !== undefined}
        aria-describedby={error ? errorId : undefined}
        label={
          <span>
            {t("auth.terms.agree")}{" "}
            <Link href="/terms" target="_blank" rel="noopener" className={link}>
              {t("auth.terms.terms")}
            </Link>{" "}
            {t("auth.terms.and")}{" "}
            <Link href="/privacy" target="_blank" rel="noopener" className={link}>
              {t("auth.terms.privacy")}
            </Link>
          </span>
        }
      />
      {error ? (
        <p
          id={errorId}
          {...(announceError ? { role: "alert" as const } : {})}
          className="flex items-start gap-1.5 text-sm text-danger"
        >
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
