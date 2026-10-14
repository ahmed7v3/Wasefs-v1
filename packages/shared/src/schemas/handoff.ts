import { z } from "zod";

import { createUploadSchema } from "./files.js";

/*
 * Desktop -> phone handoff (Phase 2, Task 2.6). The desktop asks for a capability token, shows it
 * as a QR code, and the phone adds pages to that desktop session without signing in. The token can
 * only add up to four pages; it can never start an analysis, so a leaked token cannot spend credits.
 */

/** A handoff token lives five minutes. */
export const HANDOFF_TTL_SECONDS = 300;
/** Pages one token may add. */
export const HANDOFF_MAX_FILES = 4;
/** 32 random bytes as base64url, no padding. */
export const HANDOFF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const handoffTokenParamSchema = z.object({
  token: z.string().regex(HANDOFF_TOKEN_PATTERN, "invalid token"),
});

export const handoffFileParamSchema = handoffTokenParamSchema.extend({ fileId: z.uuid() });

export const captureSessionParamSchema = z.object({ captureSessionId: z.uuid() });

/** `POST /handoff`: the id the desktop page generated for this capture session. */
export const createHandoffSchema = captureSessionParamSchema;

export const createHandoffResponseSchema = z.object({
  token: z.string().regex(HANDOFF_TOKEN_PATTERN),
  /** Where the phone goes: `<web origin>/capture/<token>`. */
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type CreateHandoffResponse = z.output<typeof createHandoffResponseSchema>;

/** `GET /handoff/:token`: the phone page asks whether the link still works and how many pages are left. */
export const handoffStatusResponseSchema = z.object({
  remaining: z.number().int().min(0).max(HANDOFF_MAX_FILES),
  expiresAt: z.iso.datetime(),
});
export type HandoffStatusResponse = z.output<typeof handoffStatusResponseSchema>;

/** The phone sends the same body as `POST /uploads`, but only prescription pages. */
export const handoffUploadSchema = createUploadSchema.extend({ purpose: z.literal("rx_page") });

/** One server-sent event on `GET /handoff/:captureSessionId/events`. */
export const handoffEventSchema = z.object({ fileId: z.uuid() });
export type HandoffEvent = z.output<typeof handoffEventSchema>;
export type HandoffUploadInput = z.output<typeof handoffUploadSchema>;
