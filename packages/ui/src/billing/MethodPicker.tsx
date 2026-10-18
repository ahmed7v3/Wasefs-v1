import { cn } from "../cn";

export interface MethodOption {
  key: string;
  label: string;
  /** What this method adds: "بدون رسوم" or "+ 7.20 ج.م.". */
  feeText: string;
  /** A method the amount does not fit; shown disabled with the reason as the hint. */
  disabled?: boolean | undefined;
  hint?: string | undefined;
}

export interface MethodPickerProps {
  /** Visible legend of the group. */
  legend: string;
  name: string;
  options: readonly MethodOption[];
  value: string | null;
  onChange: (key: string) => void;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

/**
 * The payment methods as native radios in a fieldset: arrow keys, one tab stop and the group name
 * come for free. Each row shows its own fee, so the total never changes by surprise.
 */
export function MethodPicker({
  legend,
  name,
  options,
  value,
  onChange,
  disabled = false,
  className,
}: MethodPickerProps) {
  return (
    <fieldset className={cn("flex flex-col gap-2", className)} disabled={disabled}>
      <legend className="mb-1 text-base font-semibold text-text">{legend}</legend>
      {options.map((option) => {
        const id = `${name}-${option.key}`;
        const selected = value === option.key;
        return (
          <label
            key={option.key}
            htmlFor={id}
            className={cn(
              "flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border bg-surface p-3 transition-colors duration-150",
              "has-[:focus-visible]:shadow-focus",
              selected
                ? "border-primary bg-primary-soft"
                : "border-neutral-400 hover:border-neutral-600",
              option.disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <input
              id={id}
              type="radio"
              name={name}
              value={option.key}
              checked={selected}
              disabled={option.disabled}
              onChange={() => {
                onChange(option.key);
              }}
              className="size-5 shrink-0 accent-primary"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-base font-semibold text-text">{option.label}</span>
              {option.hint ? <span className="text-sm text-text-muted">{option.hint}</span> : null}
            </span>
            <span className="shrink-0 text-base font-semibold tabular-nums text-text">
              <bdi>{option.feeText}</bdi>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
