import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { API_ENV } from "../config/config.module.js";

import type { ApiEnv } from "../config/env.js";

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5_000;
// Turnstile tokens are at most 2048 characters; anything longer is garbage we will not forward.
const MAX_TOKEN_LENGTH = 2_048;

/** Server-side Cloudflare Turnstile verification. Fails closed: if we cannot ask, nobody gets through. */
@Injectable()
export class TurnstileService {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  /** Without a secret (local dev) the check is off; production requires one (env schema). */
  get enabled(): boolean {
    return this.env.TURNSTILE_SECRET_KEY !== undefined;
  }

  async verify(token: string | undefined, remoteIp: string): Promise<boolean> {
    const secret = this.env.TURNSTILE_SECRET_KEY;
    if (secret === undefined) return true;
    if (!token || token.length > MAX_TOKEN_LENGTH) return false;

    let response: Response;
    try {
      response = await fetch(TURNSTILE_VERIFY_URL, {
        method: "POST",
        body: new URLSearchParams({ secret, response: token, remoteip: remoteIp }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (cause) {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { cause });
    }
    if (!response.ok) {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, {
        cause: new Error(`Turnstile answered ${response.status}`),
      });
    }
    const body = (await response.json().catch(() => null)) as { success?: unknown } | null;
    return body?.success === true;
  }
}
