"use client";

import { useEffect, useRef, useState } from "react";

import { CHAT_SAMPLE_AR } from "./chat-sample";
import { useReducedMotion } from "./use-reduced-motion";

import type { ChatMessage } from "./chat-types";
import "./early-visual.css";

type Props = {
  messages?: readonly ChatMessage[];
  className?: string;
  /** Optional header line (bot name). */
  title?: string;
  /** Accessible label for the typing indicator. */
  typingLabel?: string;
};

const TYPING_MS = 900;
const GAP_MS = 750;

/** Plays once when 35% visible. Rows are always laid out (hidden) so the card never changes height. */
export function WhatsAppChatMock({ messages = CHAT_SAMPLE_AR, className, title, typingLabel }: Props) {
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || reduced) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let started = false;

    const play = () => {
      if (started) return;
      started = true;
      let t = 350;
      messages.forEach((m, i) => {
        if (m.from === "bot") {
          timers.push(setTimeout(() => setTyping(true), t));
          t += TYPING_MS;
        }
        timers.push(
          setTimeout(() => {
            setTyping(false);
            setShown(i + 1);
          }, t),
        );
        t += GAP_MS;
      });
    };

    if (typeof IntersectionObserver === "undefined") {
      timers.push(setTimeout(play, 0));
      return () => timers.forEach(clearTimeout);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          play();
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(root);
    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
    };
  }, [messages, reduced]);

  const visibleCount = reduced ? messages.length : shown;

  return (
    <div ref={rootRef} className={`ev-chat${className ? ` ${className}` : ""}`}>
      {title ? (
        <div className="ev-chat-head">
          <span className="ev-chat-avatar" aria-hidden="true" />
          <span>{title}</span>
        </div>
      ) : null}
      <div className="ev-chat-body">
        {messages.map((m, i) => {
          const state =
            i < visibleCount ? "shown" : typing && i === visibleCount && m.from === "bot" ? "typing" : "hidden";
          return (
            <div key={m.id} className="ev-chat-row" data-from={m.from} data-state={state}>
              <div className="ev-chat-bubble ev-chat-content" aria-hidden={state !== "shown"}>
                {m.kind === "text" ? (
                  m.text
                ) : (
                  <div className="ev-chat-meds">
                    {m.title ? <strong>{m.title}</strong> : null}
                    {m.items.map((item) => (
                      <div key={item.name} className="ev-chat-med">
                        <span className="ev-chat-med-name">{item.name}</span>
                        <span className="ev-chat-chips">
                          {item.chips.map((c) => (
                            <span key={c} className="ev-chat-chip">
                              {c}
                            </span>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div
                className="ev-chat-bubble ev-chat-typing"
                role="status"
                aria-label={typingLabel}
                aria-hidden={state !== "typing"}
              >
                <i />
                <i />
                <i />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
