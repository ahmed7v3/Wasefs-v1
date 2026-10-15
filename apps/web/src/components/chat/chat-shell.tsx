"use client";

import { t } from "@wasfa/shared/i18n";
import { History } from "lucide-react";
import { useCallback, useState } from "react";

import { Drawer } from "../shell/drawer";

import { ChatHistory } from "./chat-history";

import type { ReactNode } from "react";

/**
 * Frame of `/ai`: the history on the inline-start side from `lg` up, a drawer below it, and the
 * conversation filling the rest of the panel. The height accounts for the app shell around it so
 * the composer stays at the bottom of the screen and only the message list scrolls.
 */
export function ChatShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-[26rem] gap-4 sm:h-[calc(100dvh-11rem)] sm:min-h-[32rem]">
      <aside className="hidden w-72 shrink-0 border-e border-border/60 pe-4 lg:block">
        <ChatHistory />
      </aside>
      <div className="relative flex min-w-0 flex-1 flex-col gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-label={t("chat.history.open")}
          onClick={() => {
            setOpen(true);
          }}
          className="absolute end-0 top-0 z-10 inline-flex size-11 items-center justify-center rounded-full text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus lg:hidden"
        >
          <History aria-hidden className="size-5" />
        </button>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
      <Drawer open={open} onClose={close} label={t("chat.history.title")}>
        {open ? <ChatHistory onNavigate={close} /> : null}
      </Drawer>
    </div>
  );
}
