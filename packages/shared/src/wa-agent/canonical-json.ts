const isDropped = (value: unknown): boolean =>
  value === undefined || typeof value === "function" || typeof value === "symbol";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    // JSON turns an undefined array slot into null; keep that so positions never shift.
    return value.map((item: unknown) => (isDropped(item) ? null : canonical(item)));
  }
  if (typeof value === "object" && value !== null) {
    const withJson = value as { toJSON?: () => unknown };
    if (typeof withJson.toJSON === "function") return canonical(withJson.toJSON());
    // No prototype: a key named "__proto__" must stay an own property, not set the prototype.
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (!isDropped(item)) out[key] = canonical(item);
    }
    return out;
  }
  return value;
}

/**
 * Deterministic JSON for hashing: object keys sorted recursively, `undefined` (and functions) dropped from
 * objects, so two argument objects that mean the same thing give the same text. Used for the idempotency
 * key of a tool call (docs/WA-AGENT-RUNTIME.md section 17.2).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value)) ?? "null";
}
