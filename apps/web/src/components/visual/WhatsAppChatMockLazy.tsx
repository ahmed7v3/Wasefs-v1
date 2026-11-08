"use client";

import dynamic from "next/dynamic";

// Below the fold on the home page: still server-rendered, but its animation code is a separate chunk
// that is not part of the page's first-load JavaScript.
export const WhatsAppChatMockLazy = dynamic(() =>
  import("./WhatsAppChatMock").then((module) => module.WhatsAppChatMock),
);
