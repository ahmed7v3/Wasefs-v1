import type { ChatMessageView, ChatSource } from "@wasfa/shared/schemas/chat";
import type { ChatDisplayMessage } from "@wasfa/ui";

/*
 * The messages on screen, as a pure reducer so the streaming rules can be tested without a browser:
 * the answer grows in place, sources and credits attach to it, and a regenerated answer replaces
 * the one it answers again.
 */

export interface ChatState {
  messages: ChatDisplayMessage[];
}

export const EMPTY_CHAT: ChatState = { messages: [] };

export type ChatAction =
  | { type: "history"; messages: ChatDisplayMessage[] }
  | { type: "older"; messages: ChatDisplayMessage[] }
  | {
      type: "turn";
      userMessageId: string;
      assistantMessageId: string;
      content: string;
      imageCount: number;
      /** The new answer takes the place of the last one. */
      regenerate: boolean;
      searching: boolean;
    }
  | { type: "delta"; text: string; thinking: string }
  | { type: "source"; source: ChatSource }
  | { type: "thought"; seconds: number }
  | { type: "credits"; charged: number }
  | { type: "finish"; status: "done" | "stopped" }
  | { type: "fail"; text: string };

/** Maps a stored message to what the list shows. */
export function toDisplayMessage(view: ChatMessageView): ChatDisplayMessage {
  const thought = view.parts.find((part) => part.type === "thought");
  const sources = view.parts.flatMap((part) =>
    part.type === "source" ? [{ url: part.url, title: part.title, domain: part.domain }] : [],
  );
  return {
    id: view.id,
    role: view.role,
    content: view.content,
    // A stored answer still marked `streaming` was cut off without being settled (a restart).
    status: view.status === "streaming" ? "stopped" : view.status,
    sources,
    imageCount: view.parts.filter((part) => part.type === "image").length,
    creditsCharged: view.creditsCharged,
    ...(thought ? { thinkingSeconds: thought.seconds } : {}),
  };
}

function lastIndex(messages: readonly ChatDisplayMessage[]): number {
  return messages.length - 1;
}

/** Changes the answer being written (the last message), if there is one. */
function withStreaming(
  state: ChatState,
  change: (message: ChatDisplayMessage) => ChatDisplayMessage,
): ChatState {
  const index = lastIndex(state.messages);
  const last = state.messages[index];
  if (!last || last.role !== "assistant" || last.status !== "streaming") return state;
  return { messages: [...state.messages.slice(0, index), change(last)] };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "history":
      return { messages: action.messages };
    case "older": {
      const known = new Set(state.messages.map((message) => message.id));
      return {
        messages: [...action.messages.filter((m) => !known.has(m.id)), ...state.messages],
      };
    }
    case "turn": {
      let messages = state.messages;
      if (action.regenerate) {
        const index = messages.findLastIndex((message) => message.role === "assistant");
        if (index !== -1) messages = messages.filter((_, at) => at !== index);
      }
      if (!messages.some((message) => message.id === action.userMessageId)) {
        messages = [
          ...messages,
          {
            id: action.userMessageId,
            role: "user",
            content: action.content,
            status: "done",
            imageCount: action.imageCount,
          },
        ];
      }
      return {
        messages: [
          ...messages,
          {
            id: action.assistantMessageId,
            role: "assistant",
            content: "",
            status: "streaming",
            thinking: "",
            sources: [],
            searching: action.searching,
          },
        ],
      };
    }
    case "delta":
      return withStreaming(state, (message) => ({
        ...message,
        content: message.content + action.text,
        thinking: (message.thinking ?? "") + action.thinking,
        // The answer started: the search is over.
        searching: action.text === "" ? message.searching : false,
      }));
    case "source":
      return withStreaming(state, (message) => {
        const known = message.sources ?? [];
        if (known.some((source) => source.url === action.source.url)) return message;
        return { ...message, sources: [...known, action.source] };
      });
    case "thought":
      return withStreaming(state, (message) => ({ ...message, thinkingSeconds: action.seconds }));
    case "credits": {
      // The credits event can arrive after `done`, so it looks for the last answer, streaming or not.
      const index = state.messages.findLastIndex((message) => message.role === "assistant");
      const target = state.messages[index];
      if (!target) return state;
      return {
        messages: state.messages.map((message, at) =>
          at === index ? { ...target, creditsCharged: action.charged } : message,
        ),
      };
    }
    case "finish":
      return withStreaming(state, (message) => ({
        ...message,
        status: action.status,
        searching: false,
      }));
    case "fail":
      return withStreaming(state, (message) => ({
        ...message,
        status: "error",
        searching: false,
        errorText: action.text,
      }));
  }
}
