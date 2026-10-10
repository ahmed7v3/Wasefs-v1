"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { z } from "zod";

import { ReauthDialog } from "../components/reauth-dialog";

import { api } from "./api-client";
import { ApiRequestError, errorReason } from "./api-error";

import type { ReactNode } from "react";

const reauthResponseSchema = z.object({ reauthAt: z.string() });

/** The API's "confirm it is you" answer: `AUTH_REQUIRED` with `details.reason = "reauth"`. */
export function isReauthRequired(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    error.code === "AUTH_REQUIRED" &&
    errorReason(error) === "reauth"
  );
}

interface ReauthApi {
  /**
   * Runs `action`. If the API asks the user to confirm their password, shows the dialog, and on
   * success runs the action exactly once more. Cancelling rethrows the original error.
   */
  run: <T>(action: () => Promise<T>) => Promise<T>;
}

const ReauthContext = createContext<ReauthApi | null>(null);

export function useReauth(): ReauthApi {
  const context = useContext(ReauthContext);
  if (!context) throw new Error("useReauth must be used inside <ReauthProvider>");
  return context;
}

export function ReauthProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // One dialog serves every action that fails at the same time.
  const waiting = useRef<Promise<boolean> | null>(null);
  const settle = useRef<((confirmed: boolean) => void) | null>(null);

  const ask = useCallback((): Promise<boolean> => {
    waiting.current ??= new Promise<boolean>((resolve) => {
      settle.current = resolve;
      setOpen(true);
    });
    return waiting.current;
  }, []);

  const finish = useCallback((confirmed: boolean) => {
    settle.current?.(confirmed);
    settle.current = null;
    waiting.current = null;
    setOpen(false);
  }, []);

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (error) {
        if (!isReauthRequired(error)) throw error;
        if (!(await ask())) throw error;
        return action();
      }
    },
    [ask],
  );

  const value = useMemo<ReauthApi>(() => ({ run }), [run]);

  return (
    <ReauthContext value={value}>
      {children}
      <ReauthDialog
        open={open}
        onConfirm={async (password) => {
          await api("/auth/reauth", {
            method: "POST",
            body: { password },
            schema: reauthResponseSchema,
          });
          finish(true);
        }}
        onCancel={() => {
          finish(false);
        }}
      />
    </ReauthContext>
  );
}
