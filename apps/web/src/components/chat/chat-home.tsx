"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { chatCreatedSchema, isChatSkill, type ChatSkill } from "@wasfa/shared/schemas/chat";
import { Card, SkillChips } from "@wasfa/ui";
import { FileScan, FlaskConical, Pill, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { api } from "../../lib/api-client";
import { announceChatsChanged, stashPendingSend } from "../../lib/chat-pending";
import { RX_CHIP_ID, skillChipItems } from "../../lib/chat-skills";
import { useChatComposer } from "../../lib/use-chat-composer";
import { ErrorNotice } from "../error-notice";

import { ChatComposerPanel } from "./chat-composer-panel";

import type { LucideIcon } from "lucide-react";

interface Suggestion {
  icon: LucideIcon;
  label: MessageKey;
  text: MessageKey;
  /** Fills the composer with this question and picks the matching skill. */
  prompt?: MessageKey;
  skill?: ChatSkill;
}

const SUGGESTIONS: readonly Suggestion[] = [
  { icon: FileScan, label: "chat.suggest.rx.label", text: "chat.suggest.rx.text" },
  {
    icon: Pill,
    label: "chat.suggest.drug.label",
    text: "chat.suggest.drug.text",
    prompt: "chat.suggest.drug.prompt",
    skill: "drug-info",
  },
  {
    icon: FlaskConical,
    label: "chat.suggest.lab.label",
    text: "chat.suggest.lab.text",
    prompt: "chat.suggest.lab.prompt",
    skill: "lab-test-interpretation",
  },
];

const cardStyle =
  "flex h-full w-full flex-col gap-3 p-5 text-start transition-colors duration-150 hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus";

/** `/ai` with no chat open: greeting, three starting points, the composer and the skill chips. */
export function ChatHome({
  name,
  initialSkill = null,
}: {
  name: string;
  /** Skill preselected by a link (`/ai?skill=drug-info`). */
  initialSkill?: ChatSkill | null;
}) {
  const router = useRouter();
  const composer = useChatComposer();
  const [skill, setSkill] = useState<ChatSkill | null>(initialSkill);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const root = useRef<HTMLDivElement>(null);

  const send = () => {
    const payload = composer.take();
    if (payload.content === "" || sending) return;
    setSending(true);
    setError(null);
    api("/ai/chats", {
      method: "POST",
      body: { ...(skill ? { skill } : {}), mode: payload.mode },
      schema: chatCreatedSchema,
    }).then(
      ({ id }) => {
        stashPendingSend({ chatId: id, ...payload });
        announceChatsChanged();
        router.push(`/ai/${id}`);
      },
      (caught: unknown) => {
        setSending(false);
        setError(caught);
        // Nothing was sent: give the message back.
        composer.setText(payload.content);
      },
    );
  };

  const choose = (suggestion: Suggestion) => {
    if (!suggestion.prompt) return;
    composer.setText(t(suggestion.prompt));
    setSkill(suggestion.skill ?? null);
    root.current?.querySelector("textarea")?.focus();
  };

  return (
    <div
      ref={root}
      className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center gap-8 overflow-y-auto py-4"
    >
      <header className="flex flex-col items-center gap-3 text-center">
        <span
          aria-hidden
          className="inline-flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary"
        >
          <Sparkles className="size-7" />
        </span>
        <h1 className="m-0 font-heading text-3xl font-bold text-primary sm:text-4xl">
          {name ? t("chat.greeting", { name }) : t("chat.greetingAnonymous")}
        </h1>
        <p className="m-0 text-lg text-text-muted">{t("chat.lead")}</p>
      </header>

      <ul aria-label={t("chat.suggest.region")} className="grid gap-4 md:grid-cols-3">
        {SUGGESTIONS.map((suggestion) => {
          const Icon = suggestion.icon;
          const inner = (
            <>
              <span
                aria-hidden
                className="inline-flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary"
              >
                <Icon className="size-5" />
              </span>
              <span className="font-heading text-lg font-semibold text-text">
                {t(suggestion.label)}
              </span>
              <span className="text-sm text-text-muted">{t(suggestion.text)}</span>
            </>
          );
          return (
            <li key={suggestion.label} className="flex">
              <Card padding="none" className="flex w-full overflow-hidden">
                {suggestion.prompt ? (
                  <button
                    type="button"
                    onClick={() => {
                      choose(suggestion);
                    }}
                    className={cardStyle}
                  >
                    {inner}
                  </button>
                ) : (
                  <Link href="/analyze" className={cardStyle}>
                    {inner}
                  </Link>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-3">
        {error ? <ErrorNotice error={error} supportHref={null} /> : null}
        <ChatComposerPanel
          composer={composer}
          streaming={false}
          onSend={send}
          onStop={() => undefined}
          disabled={sending}
          autoFocus
          chips={
            <SkillChips
              items={skillChipItems()}
              selectedId={skill}
              suggestedId={composer.attachments.count > 0 ? RX_CHIP_ID : null}
              onSelect={(id) => {
                setSkill(isChatSkill(id) ? id : null);
              }}
            />
          }
        />
      </div>
    </div>
  );
}
