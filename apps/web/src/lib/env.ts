import { validateEnv } from "@wasfa/shared/env";
import { z } from "zod";

const publicEnvSchema = z.object({
  /** Only `production` is indexable; everything else gets `Disallow: /` and `noindex`. */
  NEXT_PUBLIC_ENV: z.enum(["production", "staging", "development"]).default("development"),
  NEXT_PUBLIC_SITE_URL: z.url().default("https://wasfa.online"),
  NEXT_PUBLIC_API_URL: z.url().default("https://api.wasfa.online"),
});

export type PublicEnv = z.output<typeof publicEnvSchema>;

/**
 * Next.js inlines `process.env.NEXT_PUBLIC_*` only for literal accesses at build time, so each
 * key is spelled out here instead of passing `process.env` wholesale. Empty strings (an unset
 * Docker build arg) count as unset.
 */
function readPublicEnv(): PublicEnv {
  const source = {
    NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  };
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value));
  const result = validateEnv(publicEnvSchema, cleaned);
  if (!result.ok) {
    // Key names only, never values.
    throw new Error(
      `Invalid web environment: ${result.issues.map((issue) => issue.key).join(", ")}`,
    );
  }
  return result.data;
}

export const publicEnv = readPublicEnv();

export const isProduction = publicEnv.NEXT_PUBLIC_ENV === "production";
