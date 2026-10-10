"use client";

import { t } from "@wasfa/shared/i18n";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "./cn";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type ToastTone = "success" | "error" | "info";

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  tone: ToastTone;
}

interface ToastItemData extends ToastOptions {
  id: number;
}

export interface ToastApi {
  /** Shows a toast and returns its id. Errors stay until dismissed; the rest vanish after 5 s. */
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 5000;

const ToastContext = createContext<ToastApi | null>(null);

const tones: Record<ToastTone, { icon: LucideIcon; accent: string; iconColor: string }> = {
  success: { icon: CircleCheck, accent: "border-s-success", iconColor: "text-success" },
  error: { icon: CircleAlert, accent: "border-s-danger", iconColor: "text-danger" },
  info: { icon: Info, accent: "border-s-primary", iconColor: "text-primary" },
};

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return api;
}

function ToastItem({ data, onDismiss }: { data: ToastItemData; onDismiss: (id: number) => void }) {
  const { id, tone, title, description } = data;
  const { icon: Icon, accent, iconColor } = tones[tone];

  useEffect(() => {
    // Errors persist: the user must be able to read and act on them (DESIGN-SYSTEM §5.2).
    if (tone === "error") {
      return;
    }
    const timer = setTimeout(() => {
      onDismiss(id);
    }, AUTO_DISMISS_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [id, tone, onDismiss]);

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border border-border border-s-4 bg-surface p-3 text-text shadow-card",
        accent,
      )}
    >
      {/* The icon repeats the tone, so colour is never the only signal. */}
      <Icon aria-hidden className={cn("mt-1 size-5 shrink-0", iconColor)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
        <p className="text-base font-semibold">{title}</p>
        {description ? <p className="text-sm text-text-muted">{description}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => {
          onDismiss(id);
        }}
        aria-label={t("ui.dismiss")}
        className="-my-1 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-neutral-600 transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus"
      >
        <X aria-hidden className="size-5" />
      </button>
    </div>
  );
}

/** Mount once near the root; renders the toast stack (bottom centre on mobile, inline-end on desktop). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItemData[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    const id = nextId.current++;
    // Keep the newest MAX_VISIBLE: the oldest is dropped so the stack never covers the page.
    setItems((current) => [...current, { ...options, id }].slice(-MAX_VISIBLE));
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-3 p-4 sm:start-auto sm:end-0 sm:w-auto sm:items-end">
        {items.map((item) => (
          <ToastItem key={item.id} data={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext>
  );
}
