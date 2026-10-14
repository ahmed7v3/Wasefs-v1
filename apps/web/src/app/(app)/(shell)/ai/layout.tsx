import { ChatShell } from "../../../../components/chat/chat-shell";

import type { ReactNode } from "react";

export default function AiLayout({ children }: { children: ReactNode }) {
  return <ChatShell>{children}</ChatShell>;
}
