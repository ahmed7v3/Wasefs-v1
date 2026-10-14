import { t } from "@wasfa/shared/i18n";
import { rxEventSchema, type RxEvent } from "@wasfa/shared/schemas/rx";

import { toRequestError } from "./api-client";
import { ApiRequestError } from "./api-error";
import { createSseParser } from "./chat-stream";
import { publicEnv } from "./env";

/**
 * Follows `GET /rx/:id/events` over `fetch` (the cookie goes with it, and the stream can be aborted
 * cleanly). Resolves when the server closes the stream, which it does after `done` or `failed` and
 * after five minutes; a caller that has not seen a terminal event then reconnects or polls. Events
 * that do not match the contract are skipped, so a newer server cannot break an older page.
 */
export async function streamRxEvents(
  analysisId: string,
  signal: AbortSignal,
  onEvent: (event: RxEvent) => void,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${publicEnv.NEXT_PUBLIC_API_URL}/rx/${analysisId}/events`, {
      credentials: "include",
      headers: { Accept: "text/event-stream", "Accept-Language": "ar" },
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiRequestError("UPSTREAM_UNAVAILABLE", t("error.UPSTREAM_UNAVAILABLE"));
  }
  if (!response.ok) throw await toRequestError(response);
  if (!response.body) {
    throw new ApiRequestError("UPSTREAM_UNAVAILABLE", t("error.UPSTREAM_UNAVAILABLE"));
  }

  const parser = createSseParser((_name, data) => {
    try {
      const parsed = rxEventSchema.safeParse(JSON.parse(data));
      if (parsed.success) onEvent(parsed.data);
    } catch {
      // Not JSON: skipped.
    }
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.flush();
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiRequestError("UPSTREAM_UNAVAILABLE", t("error.UPSTREAM_UNAVAILABLE"));
  } finally {
    reader.releaseLock();
  }
}
