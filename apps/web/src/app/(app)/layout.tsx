import { ToastProvider } from "@wasfa/ui";

import type { ReactNode } from "react";

/** Toasts belong to the signed-in app only: public pages must not ship the provider (WP1 §2.3). */
export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
