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
| `runMigrations` / `MIGRATIONS_FOLDER` | `packages/db/src/migrations.ts` | Apply the package's SQL migrations to a database (CLI, tests, worker). | `await runMigrations(db)` |
| `apiEnvSchema` / `loadEnv` / `ApiEnv` | `apps/api/src/config/env.ts` | API env schema (`WEB_ORIGIN` list, 32-byte `ENCRYPTION_KEY`, `TRUST_PROXY` CIDRs); exits with key names if invalid. | `const env = loadEnv()` |
| `encryptionKey` | `apps/api/src/config/env.ts` | Decoded 32-byte key buffer from `ENCRYPTION_KEY`. | `encryptSecret(v, encryptionKey(env))` |
| `API_ENV` | `apps/api/src/config/config.module.ts` | DI token for the validated env. | `@Inject(API_ENV) env: ApiEnv` |
| `createApp` | `apps/api/src/bootstrap.ts` | Fully configured Nest/Fastify app (helmet, CORS, rate limit, filters, pipes), not listening. Used by `main.ts` and tests. | `await createApp(env, { extraImports })` |
| `encryptSecret` / `decryptSecret` | `apps/api/src/common/crypto.ts` | AES-256-GCM for admin-stored API keys; optional AAD context; throws `SecretDecryptionError` on tamper. | `encryptSecret(key, k, "ai_provider:gemini")` |
| `maskSecret` | `apps/api/src/common/crypto.ts` | Masked display for admin screens. | `maskSecret(k) // "sk-…9f2a"` |
| `DB` / `DatabaseModule` | `apps/api/src/common/database.ts` | Global pooled Drizzle handle (`.db`, `.sql`), closed on shutdown. | `@Inject(DB) h: DbHandle` |
| `REDIS` / `RedisModule` / `createRedis` | `apps/api/src/common/redis.ts` | Shared ioredis connection (fail-fast timeouts), closed on shutdown. | `@Inject(REDIS) redis: Redis` |
| `createZodDto` / `ZodValidationPipe` | `apps/api/src/common/validation.ts` | Use shared zod schemas as Nest parameter types; global pipe strips unknown keys, returns `VALIDATION_FAILED` with field paths only. | `class Dto extends createZodDto(schema) {}` |
| `RateLimit` / `SkipRateLimit` | `apps/api/src/common/rate-limit.ts` | Per-route stricter limit, or exemption (health only). | `@RateLimit(5, "1 minute")` |
| `clientIp` / `compileTrust` | `apps/api/src/common/client-ip.ts` | Real client IP; `CF-Connecting-IP` honoured only from the trusted proxy. | `clientIp(request, trust)` |
| `ErrorReporter` / `AllExceptionsFilter` / `toAppError` | `apps/api/src/common/errors.ts` | Error → `{ code, message, details?, ref? }`; unexpected errors stored in `error_events` with a ref. | `throw new AppError(ErrorCode.NOT_FOUND)` |
| `redactText` / `LOG_REDACT_PATHS` | `apps/api/src/common/redact.ts` | Scrub emails, phones, bearer tokens, DSN passwords from text; pino redact paths. | `redactText(err.message)` |
