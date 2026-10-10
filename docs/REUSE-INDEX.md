# REUSE-INDEX

Registry of every shared function/component. Search here before writing a helper; add a row when you create one.

| name | path | purpose | example |
|---|---|---|---|
| `ErrorCode` | `packages/shared/src/errors/codes.ts` | Typed error-code enum (`AUTH_REQUIRED` … `INTERNAL`). | `ErrorCode.NOT_FOUND` |
| `ERROR_CODES` | `packages/shared/src/errors/codes.ts` | Array of all error codes. | `ERROR_CODES.map(...)` |
| `ERROR_INFO` | `packages/shared/src/errors/codes.ts` | Per-code HTTP status + Arabic/English user message. | `ERROR_INFO.RATE_LIMITED.message.ar` |
| `isErrorCode` | `packages/shared/src/errors/codes.ts` | Type guard for error-code strings. | `isErrorCode(body.code)` |
| `ErrorLocale` | `packages/shared/src/errors/codes.ts` | `"ar" \| "en"` locale type for error messages. | `toResponse("ar")` |
| `AppError` | `packages/shared/src/errors/app-error.ts` | Throwable error with code, HTTP status, client-safe details; `toResponse()` builds the safe body. | `throw new AppError(ErrorCode.FORBIDDEN)` |
| `isAppError` | `packages/shared/src/errors/app-error.ts` | Type guard for `AppError`. | `if (isAppError(e)) ...` |
| `SafeDetails` | `packages/shared/src/errors/app-error.ts` | Type of client-safe `details` payload. | `{ field: "email" }` |
| `newId` | `packages/shared/src/ids.ts` | UUIDv7 generator (time-sortable). | `const id = newId()` |
| `newErrorRef` | `packages/shared/src/ids.ts` | Support reference `WSF-XXXX-XXXX` (Crockford base32, no ambiguous chars). | `const ref = newErrorRef()` |
| `isErrorRef` / `ERROR_REF_PATTERN` | `packages/shared/src/ids.ts` | Validate an error reference string. | `isErrorRef(query.ref)` |
| `toMinor` | `packages/shared/src/money.ts` | Decimal string/number → integer minor units (no float math, rejects excess decimals). | `toMinor("19.99", "USD") // 1999` |
| `fromMinor` | `packages/shared/src/money.ts` | Minor units → exact decimal string. | `fromMinor(12550, "EGP") // "125.50"` |
| `formatMoney` | `packages/shared/src/money.ts` | Locale currency formatting from minor units (Western digits by default). | `formatMoney(12550, "EGP", "ar")` |
| `currencyExponent` | `packages/shared/src/money.ts` | Decimal places for a currency. | `currencyExponent("KWD") // 3` |
| `parseEnv` | `packages/shared/src/env.ts` | Validate env at boot with a zod schema; prints bad key names (never values) and exits 1. | `const env = parseEnv(schema)` |
| `validateEnv` | `packages/shared/src/env.ts` | Non-exiting variant returning `{ ok, data \| issues }` (tests, tooling). | `validateEnv(schema, source)` |
| `t` | `packages/shared/src/i18n/index.ts` | Typed translation helper; Arabic default, English falls back to Arabic. | `t("common.errorRef", { ref })` |
| `ar` / `en` / `MessageKey` / `Locale` | `packages/shared/src/i18n/` | Dictionaries and key type. Add UI strings here, not in components. | `t("brand.name")` |
| `createDb` | `packages/db/src/client.ts` | Pooled Drizzle + postgres.js client factory (reads `DATABASE_URL`). | `const { db, close } = createDb()` |
| `schema` tables | `packages/db/src/schema/` | `siteSettings`, `featureFlags`, `auditLogs`, `errorEvents`. | `db.select().from(siteSettings)` |
| `idColumn` / `timestamps` | `packages/db/src/schema/columns.ts` | Shared column helpers: UUIDv7 PK, `created_at`/`updated_at`. | `id: idColumn()` |
