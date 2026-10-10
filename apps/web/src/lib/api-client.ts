import { isErrorCode } from "@wasfa/shared/errors";
import { t } from "@wasfa/shared/i18n";
import { z } from "zod";

import { ApiRequestError } from "./api-error";
import { publicEnv } from "./env";

/*
 * The one way the web app talks to the API from the browser (and from server code that does not
 * forward cookies). Server components that act as the signed-in user use `serverApi`/`getMe` in
 * `session.ts` instead, which forward the cookie and set `Origin`.
 */

export interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** JSON body. */
  body?: unknown;
  /** Cloudflare Turnstile token for the routes that ask for one. */
  turnstileToken?: string | null | undefined;
  signal?: AbortSignal | undefined;
}

/** `{ code, message, details?, ref? }`, the only error shape the API produces. */
const errorBodySchema = z.object({
  code: z.string().refine(isErrorCode),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  ref: z.string().optional(),
});

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Turns a non-2xx response into an `ApiRequestError`; a body that is not ours becomes `INTERNAL`. */
export async function toRequestError(response: Response): Promise<ApiRequestError> {
  const raw: unknown = await response.json().catch(() => null);
  const parsed = errorBodySchema.safeParse(raw);
  if (!parsed.success) {
    return new ApiRequestError("INTERNAL", t("error.INTERNAL"), undefined, response.status);
  }
  const { code, message, details, ref } = parsed.data;
  return new ApiRequestError(code, message, ref, response.status, details);
}

export function api(path: string, options?: ApiOptions & { schema?: undefined }): Promise<unknown>;
export function api<S extends z.ZodType>(
  path: string,
  options: ApiOptions & { schema: S },
): Promise<z.output<S>>;
export async function api(
  path: string,
  options: ApiOptions & { schema?: z.ZodType | undefined } = {},
): Promise<unknown> {
  const { method = "GET", body, schema, turnstileToken, signal } = options;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Language": "ar",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (turnstileToken) headers["x-turnstile-token"] = turnstileToken;

  let response: Response;
  try {
    response = await fetch(`${publicEnv.NEXT_PUBLIC_API_URL}${path}`, {
      method,
      credentials: "include",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiRequestError("UPSTREAM_UNAVAILABLE", t("error.UPSTREAM_UNAVAILABLE"));
  }

  if (!response.ok) throw await toRequestError(response);
  if (response.status === 204) return undefined;
  if (!schema) return undefined;

  const raw: unknown = await response.json().catch(() => undefined);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // The API answered with a shape we do not know: a deploy skew or a bug, never the user's fault.
    throw new ApiRequestError("INTERNAL", t("error.INTERNAL"), undefined, response.status);
  }
  return parsed.data;
}
