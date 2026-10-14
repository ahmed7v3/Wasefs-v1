import { t } from "@wasfa/shared/i18n";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ChatConversation } from "../../../../../components/chat/chat-conversation";
import { requireOnboarded } from "../../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("chat.title") };

const chatIdSchema = z.uuid();

export default async function AiChatPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params;
  const parsed = chatIdSchema.safeParse(chatId);
  if (!parsed.success) notFound();
  await requireOnboarded(`/ai/${parsed.data}`);
  // `key` gives each chat a fresh state: switching chats never shows the previous one's messages.
  return <ChatConversation key={parsed.data} chatId={parsed.data} />;
}
