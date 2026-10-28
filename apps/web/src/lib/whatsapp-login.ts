import type { WaLoginStatusResponse } from "@wasfa/shared/schemas/wa-login";

/*
 * Rules of "Continue with WhatsApp" (api: `auth/whatsapp-login`), apart from the component so they
 * can be unit-tested without a DOM.
 */

/** Where a brand-new account lands. `/welcome` replaces it when the one-screen onboarding ships. */
export const NEW_ACCOUNT_PATH = "/onboarding";

export type WhatsAppPhase =
  | { kind: "idle" }
  | { kind: "starting" }
  | {
      kind: "waiting";
      /** `XXXX-XXXX`, as shown and as sent back to `status`. */
      token: string;
      waLink: string;
      /** Epoch milliseconds. */
      expiresAt: number;
      mobile: boolean;
    }
  | { kind: "refused"; reason: NonNullable<WaLoginStatusResponse["reason"]> | undefined }
  | { kind: "expired" }
  | { kind: "signed_in" };

/** What a poll answer changes. `null` means keep waiting. */
export function nextPhase(
  current: Extract<WhatsAppPhase, { kind: "waiting" }>,
  answer: WaLoginStatusResponse,
  now: number,
): WhatsAppPhase | null {
  if (answer.status === "signed_in") return { kind: "signed_in" };
  if (answer.status === "refused") return { kind: "refused", reason: answer.reason };
  if (answer.status === "expired" || now >= current.expiresAt) return { kind: "expired" };
  return null;
}

/** Where to go once signed in: the vetted `next` for an existing account, onboarding for a new one. */
export function signedInTarget(next: string, isNew: boolean | undefined): string {
  return isNew === true ? NEW_ACCOUNT_PATH : next;
}

/** `m:ss`. */
export function formatCountdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A phone or tablet: touch is the primary input, or the user agent says so. Browser only. */
export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  const coarse =
    typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  return coarse || /Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent);
}

/**
 * `https://wa.me/<number>?text=...` to the WhatsApp Web equivalent for desktops, or null if the link
 * is not a wa.me link (only wa.me links are ever rendered).
 */
export function whatsappWebLink(waLink: string): string | null {
  try {
    const url = new URL(waLink);
    if (url.origin !== "https://wa.me") return null;
    const target = new URL("https://web.whatsapp.com/send");
    target.searchParams.set("phone", url.pathname.replace(/^\//, ""));
    const text = url.searchParams.get("text");
    if (text) target.searchParams.set("text", text);
    return target.toString();
  } catch {
    return null;
  }
}
