import "server-only";

import { validateEnv } from "@wasfa/shared/env";
import { z } from "zod";

import { publicEnv } from "./env";

const serverEnvSchema = z.object({
  /** Where server components reach the API (an internal network address in Docker); defaults to the public one. */
  API_INTERNAL_URL: z.url().optional(),
});

function readServerEnv(): { API_INTERNAL_URL: string } {
  const source = process.env.API_INTERNAL_URL
    ? { API_INTERNAL_URL: process.env.API_INTERNAL_URL }
    : {};
  const result = validateEnv(serverEnvSchema, source);
  if (!result.ok) {
    // Key names only, never values.
    throw new Error(
      `Invalid web server environment: ${result.issues.map((issue) => issue.key).join(", ")}`,
    );
  }
  return { API_INTERNAL_URL: result.data.API_INTERNAL_URL ?? publicEnv.NEXT_PUBLIC_API_URL };
}

export const serverEnv = readServerEnv();
