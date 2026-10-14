import { t } from "@wasfa/shared/i18n";
import { ANONYMIZED_USER_NAME } from "@wasfa/shared/identity";

import { ChatHome } from "../../../../components/chat/chat-home";
import { displayName } from "../../../../lib/labels";
import { requireOnboarded } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("chat.title") };

export default async function AiPage() {
  const me = await requireOnboarded("/ai");
  const firstName = displayName(me.name, ANONYMIZED_USER_NAME).trim().split(/\s+/)[0] ?? "";
  return <ChatHome name={firstName} />;
}
