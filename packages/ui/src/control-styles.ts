/*
 * Shared look of the text-like controls (Input, Select), DESIGN-SYSTEM §5.2.
 * The boundary is `neutral-400` (3.13:1, WCAG 1.4.11); `border`/`accent` are too light for a control.
 * Invalid styling keys off `aria-invalid` so a Field can mark any control without extra props.
 */
export const controlStyles =
  "min-h-11 w-full rounded-md border border-neutral-400 bg-surface px-4 font-body text-base text-text " +
  "placeholder:text-text-muted transition-colors duration-150 " +
  "hover:border-neutral-600 focus-visible:border-ring focus-visible:outline-none focus-visible:shadow-focus " +
  "aria-invalid:border-danger aria-invalid:hover:border-danger aria-invalid:focus-visible:border-danger " +
  "disabled:cursor-not-allowed disabled:opacity-50";
