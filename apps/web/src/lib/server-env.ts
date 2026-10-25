import "server-only";

import { validateEnv } from "@wasfa/shared/env";
import { z } from "zod";

import { publicEnv } from "./env";

const serverEnvSchema = z.object({
  /** Where server components reach the API (an internal network address in Docker); defaults to the public one. */
  API_INTERNAL_URL: z.url().optional(),
  /** Shared HMAC secret of the content-cache revalidation call (CONTENT-PLATFORM §11.5); unset = the route answers 404. */
  REVALIDATE_SECRET: z.string().min(32).optional(),
});

export interface ServerEnv {
  API_INTERNAL_URL: string;
  REVALIDATE_SECRET: string | undefined;
}

function readServerEnv(): ServerEnv {
  // Empty strings (an unset compose variable) count as unset.
  const source = Object.fromEntries(
    Object.entries({
      API_INTERNAL_URL: process.env.API_INTERNAL_URL,
      REVALIDATE_SECRET: process.env.REVALIDATE_SECRET,
    }).filter(([, value]) => value),
  );
  const result = validateEnv(serverEnvSchema, source);
  if (!result.ok) {
    // Key names only, never values.
    throw new Error(
      `Invalid web server environment: ${result.issues.map((issue) => issue.key).join(", ")}`,
    );
  }
  return {
    API_INTERNAL_URL: result.data.API_INTERNAL_URL ?? publicEnv.NEXT_PUBLIC_API_URL,
    REVALIDATE_SECRET: result.data.REVALIDATE_SECRET,
  };
}

export const serverEnv = readServerEnv();
