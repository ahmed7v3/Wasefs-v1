import { t } from "@wasfa/shared/i18n";

/**
 * A JSON value for the audit and issue screens. Always LTR (it is code), scrollable and focusable
 * so a keyboard user can scroll a wide payload (axe: scrollable regions need a tab stop).
 */
export function JsonView({ value, label }: { value: unknown; label: string }) {
  const text = value === undefined ? "" : (JSON.stringify(value, null, 2) ?? "");
  return (
    <pre
      dir="ltr"
      tabIndex={0}
      role="region"
      aria-label={label}
      className="max-h-80 overflow-auto rounded-md border border-border bg-surface p-3 text-start font-mono text-sm text-text focus-visible:outline-none focus-visible:shadow-focus"
    >
      {text === "" || text === "null" ? t("admin.audit.empty") : text}
    </pre>
  );
}
