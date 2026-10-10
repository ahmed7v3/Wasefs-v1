import {
  accounts,
  sessions,
  twoFactors,
  userRoles,
  users,
  verifications,
  type Database,
} from "@wasfa/db";
import { isPlaceholderEmail } from "@wasfa/shared/identity";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { haveIBeenPwned, twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";

import { AuthCode } from "./auth-errors.js";
import { isBlockedEmailDomain } from "./disposable-domains.js";
import { phonePasswordPlugin } from "./phone-plugin.js";
import { providerCredentials } from "./providers.js";

import type { AuthSettingsReader } from "./auth-settings.reader.js";
import type { AuthMailer } from "./mailer.js";
import type { PasswordHasher } from "./password.js";
import type { ApiEnv } from "../config/env.js";

export const SESSION_COOKIE_PREFIX = "wasfa";
/** Better Auth does not apply `cookiePrefix` to a custom cookie name, so the full name is spelled out. */
export const SESSION_COOKIE_NAME = `${SESSION_COOKIE_PREFIX}.session`;
/** Header the controller sets (after stripping any client-supplied copy) so Better Auth records the real IP. */
export const CLIENT_IP_HEADER = "x-wasfa-client-ip";

const DAY_SECONDS = 24 * 60 * 60;
/** Anyone holding a platform role is an admin for session purposes (SECURITY.md §4). */
export const ADMIN_SESSION_SECONDS = 12 * 60 * 60;

export interface AuthDeps {
  env: ApiEnv;
  db: Database;
  mailer: AuthMailer;
  settings: AuthSettingsReader;
  passwords: PasswordHasher;
  log: (level: "debug" | "info" | "warn" | "error", message: string) => void;
}

/** True when the user holds at least one platform role (support, marketing, finance, admin, ...). */
export async function holdsPlatformRole(db: Database, userId: string): Promise<boolean> {
  const rows = await db
    .select({ roleKey: userRoles.roleKey })
    .from(userRoles)
    .where(eq(userRoles.userId, userId))
    .limit(1);
  return rows.length > 0;
}

/**
 * Better Auth, configured for Wasfa. Better Auth authenticates only; organizations, roles and
 * permissions are our own tables (Phase 1 decision #1). Choices worth knowing:
 *
 * - Database sessions, `cookieCache` off: revoking a session or suspending a user takes effect on
 *   the very next request.
 * - Ids come from Postgres (`generateId: false`), so rows get UUIDv7 keys.
 * - Better Auth's own rate limiter is off: `AuthPolicy` limits per IP and per identifier, in Redis,
 *   and fails closed.
 * - Only the endpoints in `AuthPolicy`'s allowlist are reachable; the plugin's other routes are not.
 */
export function createAuth(deps: AuthDeps) {
  const { env, db, mailer, settings, passwords, log } = deps;
  const webOrigin = env.WEB_ORIGIN[0] ?? "";
  const google = providerCredentials(env, "google");
  const facebook = providerCredentials(env, "facebook");

  const sendInBackground = (send: () => Promise<void>) => {
    // Never awaited: the response time must not reveal whether an address has an account.
    send().catch(() => log("error", "Auth email enqueue failed"));
  };

  return betterAuth({
    appName: "Wasfa AI",
    baseURL: env.API_PUBLIC_URL,
    basePath: "/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [...env.WEB_ORIGIN],
    telemetry: { enabled: false },
    rateLimit: { enabled: false },
    // Message only: Better Auth's extra arguments can carry identifiers.
    logger: {
      level: "warn",
      log: (level, message) => log(level, message),
    },
    onAPIError: { errorURL: `${webOrigin}/login` },

    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        twoFactor: twoFactors,
      },
    }),

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      password: { hash: passwords.hash, verify: passwords.verify },
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) => {
        if (!isPlaceholderEmail(user.email)) {
          sendInBackground(() =>
            mailer.sendPasswordResetEmail({ to: user.email, name: user.name, url }),
          );
        }
        return Promise.resolve();
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      // Verifying proves the mailbox, not that the person at the keyboard is the account holder.
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60,
      sendVerificationEmail: ({ user, url }) => {
        if (!isPlaceholderEmail(user.email)) {
          sendInBackground(() =>
            mailer.sendVerificationEmail({ to: user.email, name: user.name, url }),
          );
        }
        return Promise.resolve();
      },
    },

    socialProviders: {
      ...(google ? { google: { ...google, prompt: "select_account" as const } } : {}),
      ...(facebook ? { facebook } : {}),
    },

    account: {
      // Provider tokens are never used by our code; if stored they are encrypted.
      encryptOAuthTokens: true,
      // A social login is linked to an existing account only when both sides have a verified email
      // (`requireLocalEmailVerified` is Better Auth's default; pinned here because it is what stops
      // pre-registration takeover: nobody can squat an address and inherit the owner's Google login).
      accountLinking: { enabled: true, trustedProviders: [], requireLocalEmailVerified: true },
    },

    session: {
      expiresIn: 30 * DAY_SECONDS,
      // Sliding: activity at most once a day pushes the expiry out again.
      updateAge: DAY_SECONDS,
      cookieCache: { enabled: false },
    },

    advanced: {
      database: { generateId: false },
      cookiePrefix: SESSION_COOKIE_PREFIX,
      useSecureCookies: true,
      cookies: { session_token: { name: SESSION_COOKIE_NAME } },
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
      ...(env.AUTH_COOKIE_DOMAIN
        ? { crossSubDomainCookies: { enabled: true, domain: env.AUTH_COOKIE_DOMAIN } }
        : {}),
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },

    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const access = await settings.access();
            if (!access.signupOpen) {
              // Not 403: Better Auth answers a 403 during sign-up with a fake success, to hide duplicates.
              throw APIError.from("BAD_REQUEST", {
                code: AuthCode.SIGNUP_CLOSED,
                message: "Sign-up is closed",
              });
            }
            if (!isPlaceholderEmail(user.email)) {
              const auth = await settings.auth();
              if (isBlockedEmailDomain(user.email, auth.blockedEmailDomains)) {
                throw APIError.from("BAD_REQUEST", {
                  code: AuthCode.EMAIL_DOMAIN_BLOCKED,
                  message: "Email domain is not allowed",
                });
              }
            }
          },
        },
      },
      session: {
        create: {
          before: async (session, context) => {
            const [user] = await db
              .select({ status: users.status, twoFactorEnabled: users.twoFactorEnabled })
              .from(users)
              .where(eq(users.id, session.userId));
            if (!user || user.status === "deleted") {
              throw APIError.from("UNAUTHORIZED", {
                code: AuthCode.INVALID_CREDENTIALS,
                message: "Invalid credentials",
              });
            }
            if (user.status === "suspended") {
              throw APIError.from("FORBIDDEN", {
                code: AuthCode.ACCOUNT_SUSPENDED,
                message: "Account suspended",
              });
            }
            // Better Auth runs its TOTP challenge only for password sign-ins. A social callback would
            // hand out a full session without it, so accounts with 2FA must use password + code.
            if (user.twoFactorEnabled && context?.path?.startsWith("/callback")) {
              throw APIError.from("FORBIDDEN", {
                code: AuthCode.TWO_FACTOR_USE_PASSWORD,
                message: "Use password and authenticator code",
              });
            }
            if (await holdsPlatformRole(db, session.userId)) {
              const cap = new Date(Date.now() + ADMIN_SESSION_SECONDS * 1000);
              if (session.expiresAt > cap) {
                return { data: { ...session, expiresAt: cap } };
              }
            }
            return undefined;
          },
          after: async (session) => {
            await db
              .update(users)
              .set({ lastLoginAt: new Date() })
              .where(eq(users.id, session.userId));
          },
        },
      },
    },

    plugins: [
      haveIBeenPwned({
        paths: ["/sign-up/email", "/sign-up/phone-number", "/change-password", "/reset-password"],
      }),
      phonePasswordPlugin(passwords),
      twoFactor({ issuer: "Wasfa AI" }),
    ],
  });
}

export type AuthInstance = ReturnType<typeof createAuth>;
