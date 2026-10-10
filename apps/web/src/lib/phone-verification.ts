import { PHONE_VERIFY_STATUSES } from "@wasfa/shared/schemas/phone";
import { z } from "zod";

/*
 * Wire shapes and state rules of phone verification by inbound WhatsApp (api: `phone.service.ts`).
 * Kept apart from the component so the rules can be unit-tested without a DOM.
 */

export const UNAVAILABLE_REASONS = ["disabled", "not_configured", "bridge_down"] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

/** `POST /phone/verify/start`. `expiresAt` is an ISO date here, but epoch milliseconds in the status. */
export const startResponseSchema = z.object({
  status: z.enum(["pending", "verified"]),
  code: z.string().optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  /** Only a wa.me link is ever rendered as the "Open WhatsApp" target. */
  waLink: z.string().startsWith("https://wa.me/").optional(),
  waNumber: z.string().optional(),
});
export type StartResponse = z.output<typeof startResponseSchema>;

/** `GET /phone/verify/status`: the challenge state plus whether the feature is available at all. */
export const statusResponseSchema = z.object({
  status: z.enum(PHONE_VERIFY_STATUSES),
  phone: z.string().optional(),
  expiresAt: z.number().optional(),
  failureReason: z.literal("phone_in_use").optional(),
  available: z.boolean(),
  unavailableReason: z.enum(UNAVAILABLE_REASONS).optional(),
});
export type StatusResponse = z.output<typeof statusResponseSchema>;

export interface WaitingDetails {
  code?: string | undefined;
  waLink?: string | undefined;
  waNumber?: string | undefined;
  phone?: string | undefined;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export type Phase =
  | { kind: "checking" }
  | { kind: "unavailable"; reason?: UnavailableReason | undefined }
  | { kind: "form" }
  | { kind: "waiting"; details: WaitingDetails }
  | { kind: "verified"; phone?: string | undefined }
  | { kind: "failed"; reason?: "phone_in_use" | undefined }
  | { kind: "expired" };

/** Where the screen starts, given the first status answer. */
export function initialPhase(status: StatusResponse, now: number): Phase {
  if (!status.available) return { kind: "unavailable", reason: status.unavailableReason };
  switch (status.status) {
    case "verified":
      return { kind: "verified", phone: status.phone };
    case "failed":
      return { kind: "failed", reason: status.failureReason };
    case "pending":
      // A challenge from before a page reload: its code and link are not returned again.
      return status.expiresAt !== undefined && status.expiresAt > now
        ? { kind: "waiting", details: { phone: status.phone, expiresAt: status.expiresAt } }
        : { kind: "expired" };
    case "none":
      return { kind: "form" };
  }
}

/** What a poll changes while waiting; `null` means "keep waiting". */
export function pollPhase(status: StatusResponse, expiresAt: number, now: number): Phase | null {
  if (!status.available) return { kind: "unavailable", reason: status.unavailableReason };
  switch (status.status) {
    case "verified":
      return { kind: "verified", phone: status.phone };
    case "failed":
      return { kind: "failed", reason: status.failureReason };
    case "none":
      // The challenge is gone on the server (expired or used up).
      return { kind: "expired" };
    case "pending":
      return now >= expiresAt ? { kind: "expired" } : null;
  }
}

/** Reasons the start call uses to say the feature is off (`phone_verification_<reason>`). */
export function unavailableFromReason(
  reason: string | undefined,
): UnavailableReason | "unknown" | null {
  if (!reason?.startsWith("phone_verification_")) return null;
  const rest = reason.slice("phone_verification_".length);
  return (UNAVAILABLE_REASONS as readonly string[]).includes(rest)
    ? (rest as UnavailableReason)
    : "unknown";
}
