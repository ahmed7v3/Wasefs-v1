import { waLoginAvailabilityResponseSchema } from "@wasfa/shared/schemas/wa-login";

import { serverApi } from "./session";

/**
 * Whether the auth pages draw "Continue with WhatsApp": the admin setting is on and a bridge number
 * is configured. A failing check hides the button; the password forms never depend on it.
 */
export async function loadWhatsAppAvailable(): Promise<boolean> {
  try {
    const { available } = await serverApi("/auth/whatsapp/availability", {
      schema: waLoginAvailabilityResponseSchema,
    });
    return available;
  } catch {
    return false;
  }
}
