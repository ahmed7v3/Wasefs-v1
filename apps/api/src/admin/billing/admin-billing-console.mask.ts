/*
 * Masking for the admin billing console. Lists and records show enough to recognise a customer
 * (first letter, last digits) and never the sealed sender phone, a full transaction id or a contact
 * detail (ADMIN-CONSOLE-SPEC §2). Phone and e-mail masking live in `@wasfa/shared/subscriptions`.
 */

/** `A***`: a label that tells an admin who is meant without printing the full name. */
export function maskName(name: string | null | undefined): string {
  const first = name?.trim().slice(0, 1);
  return first ? `${first}***` : "***";
}

/** Everything but the last four characters of a transfer or provider id. */
export function maskTail(value: string | null, visible = 4): string | null {
  if (value === null) return null;
  // A value that short would be shown whole by the rule below.
  if (value.length <= visible) return "*".repeat(value.length);
  return `${"*".repeat(Math.max(0, value.length - visible))}${value.slice(-visible)}`;
}
