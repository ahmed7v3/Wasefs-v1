import { randomBytes } from "node:crypto";

import { PHONE_PLACEHOLDER_EMAIL_DOMAIN } from "@wasfa/shared/identity";
import { signInPhoneSchema, signUpPhoneSchema } from "@wasfa/shared/schemas/auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";

import { AuthCode } from "./auth-errors.js";

import type { PasswordHasher } from "./password.js";
import type { BetterAuthPlugin } from "better-auth";

/**
 * Phone + password accounts. This replaces Better Auth's `phone-number` plugin on purpose:
 *
 * - Its sign-in checks "phone verified?" **before** the password, so anyone could learn whether a
 *   number is registered-but-unverified without knowing the password.
 * - It looks the user up by phone alone, but unverified phones are not unique (anyone can claim any
 *   number; only the WhatsApp proof of Task 1.5 makes it theirs), so the wrong account could match.
 * - Its OTP endpoints would be a second, weaker verification path next to ours.
 *
 * Here sign-in matches **verified** phones only, always spends one password verification (a dummy
 * hash when the account is missing) and answers every failure identically. The endpoint path is
 * `/sign-in/phone-number` because Better Auth's two-factor hook is keyed on that exact path: a
 * different name would let phone sign-in skip TOTP.
 *
 * The fields are mapped onto `users.phone` and `users.phone_verified`; `phone_verified_at` is only
 * ever written by the verification flow.
 */
export function phonePasswordPlugin(passwords: PasswordHasher): BetterAuthPlugin {
  const invalid = () =>
    APIError.from("UNAUTHORIZED", {
      code: AuthCode.INVALID_CREDENTIALS,
      message: "Invalid phone number or password",
    });

  return {
    id: "wasfa-phone-password",
    schema: {
      user: {
        fields: {
          phone: { type: "string", required: false, input: false },
          phoneVerified: { type: "boolean", required: false, input: false, defaultValue: false },
        },
      },
    },
    endpoints: {
      signUpPhoneNumber: createAuthEndpoint(
        "/sign-up/phone-number",
        { method: "POST", body: signUpPhoneSchema },
        async (ctx) => {
          const { name, phoneNumber, password } = ctx.body;
          // Hashing goes through the shared context, where the breached-password check hooks in.
          const hashed = await ctx.context.password.hash(password);
          const user = await ctx.context.internalAdapter.createUser(
            {
              name,
              email: `p${randomBytes(12).toString("hex")}@${PHONE_PLACEHOLDER_EMAIL_DOMAIN}`,
              emailVerified: false,
              phone: phoneNumber,
              phoneVerified: false,
            },
            { method: "phone-number" },
          );
          await ctx.context.internalAdapter.linkAccount({
            userId: user.id,
            providerId: "credential",
            accountId: user.id,
            password: hashed,
          });
          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ user: { id: user.id, name: user.name, emailVerified: false } });
        },
      ),
      signInPhoneNumber: createAuthEndpoint(
        "/sign-in/phone-number",
        { method: "POST", body: signInPhoneSchema },
        async (ctx) => {
          const { phoneNumber, password, rememberMe } = ctx.body;
          const user = await ctx.context.adapter.findOne<{ id: string }>({
            model: "user",
            where: [
              { field: "phone", value: phoneNumber },
              { field: "phoneVerified", value: true },
            ],
          });
          const credential = user
            ? await ctx.context.internalAdapter.findCredentialAccount(user.id)
            : null;
          const stored = credential?.password ?? (await passwords.dummyHash());
          const valid = await passwords.verify({ hash: stored, password });
          if (!user || !credential?.password || !valid) throw invalid();

          const session = await ctx.context.internalAdapter.createSession(
            user.id,
            rememberMe === false,
          );
          const fullUser = await ctx.context.internalAdapter.findUserById(user.id);
          if (!fullUser) throw invalid();
          await setSessionCookie(ctx, { session, user: fullUser }, rememberMe === false);
          return ctx.json({
            user: { id: fullUser.id, name: fullUser.name, emailVerified: fullUser.emailVerified },
          });
        },
      ),
    },
  };
}
