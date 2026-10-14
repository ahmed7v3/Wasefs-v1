"use client";

import { useCallback, useState } from "react";

import { useChatAttachments } from "./use-chat-attachments";
import { useChatCapabilities } from "./use-chat-capabilities";

import type { AiMode } from "@wasfa/shared/ai";

export interface ComposerPayload {
  content: string;
  fileIds: string[];
  mode: AiMode;
  search: boolean;
}

/**
 * Everything the composer holds: the draft, the chosen mode and search toggle (clamped to what the
 * plan offers) and the attached pictures. `take()` hands the message over and empties the composer.
 */
export function useChatComposer() {
  const capabilities = useChatCapabilities();
  const attachments = useChatAttachments();
  const [text, setText] = useState("");
  const [modeChoice, setModeChoice] = useState<AiMode | null>(null);
  const [searchChoice, setSearchChoice] = useState(false);

  const mode =
    modeChoice && capabilities.modes.includes(modeChoice) ? modeChoice : capabilities.defaultMode;
  const search = searchChoice && capabilities.webSearch;

  /** The mode/search a message sent now would use, without consuming the draft (regenerate). */
  const settings = useCallback(() => ({ mode, search }), [mode, search]);

  const take = useCallback((): ComposerPayload => {
    const payload = { content: text.trim(), fileIds: attachments.fileIds, mode, search };
    setText("");
    attachments.clear();
    return payload;
  }, [text, attachments, mode, search]);

  return {
    capabilities,
    attachments,
    text,
    setText,
    mode,
    setMode: setModeChoice,
    search,
    setSearch: setSearchChoice,
    settings,
    take,
  };
}

export type ChatComposerState = ReturnType<typeof useChatComposer>;
