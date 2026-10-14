import { t } from "@wasfa/shared/i18n";
import { ANONYMIZED_USER_NAME } from "@wasfa/shared/identity";
import { isChatSkill } from "@wasfa/shared/schemas/chat";

import { ChatHome } from "../../../../components/chat/chat-home";
import { displayName } from "../../../../lib/labels";
import { requireOnboarded } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("chat.title") };

export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<{ skill?: string | string[] | undefined }>;
}) {
  // The dashboard's tool cards open `/ai?skill=<skill>`; anything that is not a skill is ignored.
  const { skill } = await searchParams;
  const initialSkill = typeof skill === "string" && isChatSkill(skill) ? skill : null;
  const me = await requireOnboarded(initialSkill ? `/ai?skill=${initialSkill}` : "/ai");
  const firstName = displayName(me.name, ANONYMIZED_USER_NAME).trim().split(/\s+/)[0] ?? "";
  return <ChatHome name={firstName} initialSkill={initialSkill} />;
}
