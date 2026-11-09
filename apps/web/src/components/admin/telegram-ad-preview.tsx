"use client";

import { t } from "@wasfa/shared/i18n";
import { cn } from "@wasfa/ui";
import { ImageIcon } from "lucide-react";
import { useState } from "react";

import {
  TELEGRAM_CAPTION_MAX,
  captionParts,
  heroCaptionLength,
} from "../../lib/telegram-ads-admin";

import type { TelegramAdButton, TelegramAdLayout } from "@wasfa/shared/telegram-ads";

export interface TelegramAdPreviewProps {
  layout: TelegramAdLayout;
  headline: string;
  body: string;
  imageUrl: string | null;
  buttons: readonly TelegramAdButton[];
  buttonsPerRow: 1 | 2;
  /** `settings.allowReactions`: the 👍 button of the bot. */
  allowReactions: boolean;
  /** `settings.allowHide`: the "hide ads" button of the bot. */
  allowHide: boolean;
}

type PreviewLocale = "ar" | "en";
type Chat = "light" | "dark";

const chatStyles: Record<Chat, { wrap: string; bubble: string; button: string; muted: string }> = {
  light: {
    wrap: "bg-[#dce6ee]",
    bubble: "bg-white text-[#17212b]",
    button: "bg-[#17212b]/10 text-[#2a6ea6]",
    muted: "text-[#6c7883]",
  },
  dark: {
    wrap: "bg-[#0e1621]",
    bubble: "bg-[#182533] text-[#f5f5f5]",
    button: "bg-white/10 text-[#6ab3f3]",
    muted: "text-[#7f91a4]",
  },
};

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    rows.push(items.slice(index, index + size));
  return rows;
}

function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: readonly { value: V; label: string }[];
  onChange: (value: V) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-lg border border-border"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => {
            onChange(option.value);
          }}
          className={cn(
            "min-h-11 px-3 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-focus",
            value === option.value
              ? "bg-primary text-on-primary"
              : "bg-surface text-text hover:bg-primary-soft",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A Telegram-style message bubble that mirrors what the bot sends (docs: telegram ads): hero = image
 * on top with the caption, card = text bubble, compact = one line; then the link buttons and the
 * 👍 / hide row. Preview only: the bot builds the real message. It has its own Arabic/English and
 * light/dark switches because a chat shows the ad in the user's language and theme.
 */
export function TelegramAdPreview(props: TelegramAdPreviewProps) {
  const { layout, headline, body, imageUrl, buttons, buttonsPerRow, allowReactions, allowHide } =
    props;
  const [locale, setLocale] = useState<PreviewLocale>("ar");
  const [chat, setChat] = useState<Chat>("light");
  const style = chatStyles[chat];
  const parts = captionParts(headline, body, locale);
  const empty = parts.headline === "";
  const captionLength = heroCaptionLength(headline, body, locale);
  const overCaption = layout === "hero" && captionLength > TELEGRAM_CAPTION_MAX;
  const dir = locale === "ar" ? "rtl" : "ltr";

  const reactions: string[] = [];
  if (allowReactions) reactions.push(t("admin.tgAds.preview.interested", undefined, locale));
  if (allowHide) reactions.push(t("admin.tgAds.preview.hide", undefined, locale));
  const linkRows = chunk(buttons, buttonsPerRow);

  return (
    <figure className="flex flex-col gap-3" data-testid="tg-preview" data-layout={layout}>
      <figcaption className="text-base font-semibold text-text">
        {t("admin.tgAds.preview.title")}
      </figcaption>
      <div className="flex flex-wrap gap-2">
        <Segmented
          label={t("admin.tgAds.preview.language")}
          value={locale}
          onChange={setLocale}
          options={[
            { value: "ar", label: t("admin.tgAds.preview.langAr") },
            { value: "en", label: t("admin.tgAds.preview.langEn") },
          ]}
        />
        <Segmented
          label={t("admin.tgAds.preview.background")}
          value={chat}
          onChange={setChat}
          options={[
            { value: "light", label: t("admin.tgAds.preview.light") },
            { value: "dark", label: t("admin.tgAds.preview.dark") },
          ]}
        />
      </div>

      <div className={cn("rounded-xl p-3", style.wrap)}>
        <div dir={dir} className="flex max-w-sm flex-col gap-1" data-testid="tg-bubble">
          <div className={cn("overflow-hidden rounded-xl shadow-sm", style.bubble)}>
            {layout === "hero" ? (
              imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- an admin preview of a CDN variant
                <img src={imageUrl} alt="" className="aspect-[16/9] w-full object-cover" />
              ) : (
                <div
                  className={cn(
                    "flex aspect-[16/9] w-full items-center justify-center bg-black/10",
                    style.muted,
                  )}
                  data-testid="tg-no-image"
                >
                  <ImageIcon aria-hidden className="size-8" />
                  <span className="sr-only">{t("admin.tgAds.preview.noImage")}</span>
                </div>
              )
            ) : null}
            <div className="px-3 py-2 text-sm leading-relaxed">
              {layout === "compact" ? (
                <p className="break-words" data-testid="tg-line">
                  <span className={style.muted}>{parts.label}</span>{" "}
                  <b>{empty ? t("admin.tgAds.preview.empty") : parts.headline}</b>
                </p>
              ) : (
                <>
                  <p className={cn("text-xs", style.muted)} data-testid="tg-label">
                    {parts.label}
                  </p>
                  <p className="break-words font-bold" data-testid="tg-headline">
                    {empty ? t("admin.tgAds.preview.empty") : parts.headline}
                  </p>
                  {parts.body === "" ? null : (
                    <p className="mt-1 whitespace-pre-line break-words" data-testid="tg-body">
                      {parts.body}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
          {linkRows.map((row, index) => (
            <div key={index} className="flex gap-1">
              {row.map((button, position) => (
                <span
                  key={position}
                  className={cn(
                    "min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-center text-sm font-semibold",
                    style.button,
                  )}
                  data-testid="tg-link-button"
                >
                  {button.label.trim() === "" ? t("admin.tgAds.preview.buttonEmpty") : button.label}
                </span>
              ))}
            </div>
          ))}
          {reactions.length > 0 ? (
            <div className="flex gap-1" data-testid="tg-reactions">
              {reactions.map((label) => (
                <span
                  key={label}
                  className={cn(
                    "min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-center text-sm",
                    style.button,
                  )}
                >
                  {label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {layout === "hero" ? (
        <p
          className={cn("text-sm", overCaption ? "font-semibold text-danger" : "text-text-muted")}
          role={overCaption ? "alert" : undefined}
          data-testid="tg-caption-count"
        >
          {overCaption
            ? t("admin.tgAds.preview.captionOver", {
                count: captionLength,
                max: TELEGRAM_CAPTION_MAX,
              })
            : t("admin.tgAds.preview.captionCount", {
                count: captionLength,
                max: TELEGRAM_CAPTION_MAX,
              })}
        </p>
      ) : null}
    </figure>
  );
}
