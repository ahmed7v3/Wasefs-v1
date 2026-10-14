import { t } from "@wasfa/shared/i18n";
import { parseChatEvent, type ChatEvent, type SendMessageInput } from "@wasfa/shared/schemas/chat";

import { toRequestError } from "./api-client";
import { ApiRequestError } from "./api-error";
import { publicEnv } from "./env";

/*
 * Server-sent events for the assistant over `fetch` (an `EventSource` cannot POST). The parser is
 * separate from the transport so it can be tested with chunks cut at any byte.
 */

export interface SseParser {
  /** Feeds a decoded chunk; complete events are delivered right away. */
  push(chunk: string): void;
  /** The connection ended: delivers an event that was not closed by a blank line. */
  flush(): void;
}

/**
 * Incremental parser of the SSE wire format: `event:`/`data:` fields, a blank line ends an event,
 * lines starting with `:` are comments, `\r\n`, `\n` and `\r` all end a line.
 */
export function createSseParser(onEvent: (name: string, data: string) => void): SseParser {
  let pending = "";
  let name = "";
  let data: string[] = [];
  let skipLeadingLineFeed = false;

  const dispatch = () => {
    if (data.length > 0) onEvent(name || "message", data.join("\n"));
    name = "";
    data = [];
  };

  const line = (text: string) => {
    if (text === "") {
      dispatch();
      return;
    }
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") name = value;
    else if (field === "data") data.push(value);
  };

  return {
    push(chunk) {
      let text = chunk;
      // A `\r\n` split across two chunks: the `\n` that follows a `\r` we already ended a line on.
      if (skipLeadingLineFeed && text.startsWith("\n")) text = text.slice(1);
      skipLeadingLineFeed = false;
      pending += text;
      let start = 0;
      for (let index = 0; index < pending.length; index += 1) {
        const char = pending[index];
        if (char !== "\n" && char !== "\r") continue;
        line(pending.slice(start, index));
        if (char === "\r") {
          if (pending[index + 1] === "\n") index += 1;
          else if (index + 1 === pending.length) skipLeadingLineFeed = true;
        }
        start = index + 1;
      }
      pending = pending.slice(start);
    },
    flush() {
      if (pending !== "") line(pending);
      pending = "";
      dispatch();
    },
  };
}

/**
 * Sends a message and reads the answer as it is produced. Resolves when the stream ends. A refusal
 * before the stream opens (plan, quota, kill switch, credits, busy) rejects with an `ApiRequestError`;
 * an abort rejects with the `AbortError` untouched, so the caller can tell a stop from a failure.
 */
export async function streamChatMessage(
  chatId: string,
  body: Pick<SendMessageInput, "mode"> & Partial<Omit<SendMessageInput, "mode">>,
  signal: AbortSignal,
  onEvent: (event: ChatEvent) => void,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${publicEnv.NEXT_PUBLIC_API_URL}/ai/chats/${chatId}/messages`, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "text/event-stream",
        "Accept-Language": "ar",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiRequestError("UPSTREAM_UNAVAILABLE", t("error.UPSTREAM_UNAVAILABLE"));
  }
  if (!response.ok) throw await toRequestError(response);
  if (!response.body)
    throw new ApiRequestError("UPSTREAM_UNAVAILABLE", t("error.UPSTREAM_UNAVAILABLE"));

  const parser = createSseParser((name, data) => {
    // Unknown events and malformed data are skipped: a newer server must not break an older page.
    const event = parseChatEvent(name, data);
    if (event) onEvent(event);
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
    // The connection dropped mid-answer; what arrived is already shown.
    throw new ApiRequestError("UPSTREAM_UNAVAILABLE", t("error.UPSTREAM_UNAVAILABLE"));
  } finally {
    reader.releaseLock();
  }
}
