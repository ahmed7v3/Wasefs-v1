import {
  index,
  integer,
  boolean,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { idColumn, timestamps } from "./columns.js";
import { users } from "./users.js";

/*
 * Better Auth core + two-factor tables. Column names follow `@better-auth/cli generate`
 * (v1.7.7) so its Drizzle adapter works unchanged; only the keys, types, indexes and the
 * UUIDv7 defaults are ours. `users` lives in users.ts.
 */

export const sessions = pgTable(
  "sessions",
  {
    id: idColumn(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The opaque value in the cookie. Unique, and never logged.
    token: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    // PII: shown to the owner in "my sessions", purged with the session.
    ipAddress: text(),
    userAgent: text(),
    ...timestamps(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: idColumn(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The user's id at the provider (or the user's own id for the `credential` provider).
    accountId: text().notNull(),
    // `credential` (email/phone + password), `google`, `facebook`, ...
    providerId: text().notNull(),
    // Secrets. `password` is an Argon2id hash. The OAuth tokens must be encrypted by Better Auth
    // (`account.encryptOAuthTokens`, Task 1.3); they are never read by our own code.
    password: text(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    ...timestamps(),
  },
  (table) => [
    index("accounts_user_id_idx").on(table.userId),
    // The same provider identity can be linked to one user only.
    uniqueIndex("accounts_provider_account_key").on(table.providerId, table.accountId),
  ],
);

/** Short-lived proofs: email verification and password-reset tokens. Expired rows are purged by a worker job. */
export const verifications = pgTable(
  "verifications",
  {
    id: idColumn(),
    // May embed a token: never log it.
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

/** TOTP secret and backup codes. Better Auth stores both encrypted with `BETTER_AUTH_SECRET`. */
export const twoFactors = pgTable(
  "two_factors",
  {
    id: idColumn(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    secret: text().notNull(),
    backupCodes: text().notNull(),
    // False until the user proves the authenticator works; only then is 2FA switched on.
    verified: boolean().default(true),
    // Brute-force lockout on the 6-digit code.
    failedVerificationCount: integer().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
  },
  (table) => [index("two_factors_user_id_idx").on(table.userId)],
);

export type Session = typeof sessions.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Verification = typeof verifications.$inferSelect;
export type TwoFactor = typeof twoFactors.$inferSelect;
