"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { captureFirstTouch, pingOnce, setTrackedVariant } from "../../lib/early-tracking";

import { EarlyDetailsSheet } from "./EarlyDetailsSheet";

import type { EarlyDetailsResponse, EarlyJoinResponse } from "@wasfa/shared/schemas/early-access";
import type { ReactNode } from "react";

interface EarlyJoinState {
  /** Step 1 result: the phone is saved. Null until the visitor joins. */
  join: EarlyJoinResponse | null;
  /** Step 2 result: the visitor finished the questions. */
  details: EarlyDetailsResponse | null;
  /** The phone bars call this after a successful step 1: it opens the sheet. */
  joined: (join: EarlyJoinResponse) => void;
  openSheet: () => void;
}

const EarlyJoinContext = createContext<EarlyJoinState | null>(null);

export function useEarlyJoin(): EarlyJoinState {
  const value = useContext(EarlyJoinContext);
  if (!value) throw new Error("useEarlyJoin must be used inside <EarlyJoinProvider>");
  return value;
}

/**
 * One owner of the funnel state for the whole page: both phone bars (hero and final call to
 * action) and the single step-2 sheet share it. Also fires the `view` event once per page load.
 */
export function EarlyJoinProvider({
  variant,
  children,
}: {
  /** The headline variant the server rendered ("a" | "b" | "c"). */
  variant: string;
  children: ReactNode;
}) {
  const [join, setJoin] = useState<EarlyJoinResponse | null>(null);
  const [details, setDetails] = useState<EarlyDetailsResponse | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setTrackedVariant(variant);
    captureFirstTouch();
    pingOnce("view");
  }, [variant]);

  const openSheet = useCallback(() => {
    pingOnce("details_view");
    setOpen(true);
  }, []);

  const joined = useCallback(
    (result: EarlyJoinResponse) => {
      setJoin(result);
      openSheet();
    },
    [openSheet],
  );

  const value = useMemo<EarlyJoinState>(
    () => ({ join, details, joined, openSheet }),
    [join, details, joined, openSheet],
  );

  return (
    <EarlyJoinContext.Provider value={value}>
      {children}
      {open && join ? (
        <EarlyDetailsSheet
          join={join}
          details={details}
          onDetails={setDetails}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </EarlyJoinContext.Provider>
  );
}
