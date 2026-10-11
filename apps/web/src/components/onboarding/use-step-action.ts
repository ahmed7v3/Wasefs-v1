"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Busy and error state for a wizard action that is not a `useApiForm` submit (a button that sends
 * `{}` or `{ followed }`). One call at a time: a second click while the first runs is ignored.
 */
export function useStepAction<A>(run: (argument: A) => Promise<void>) {
  const latest = useRef(run);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    latest.current = run;
  }, [run]);

  const start = useCallback((argument: A) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    latest
      .current(argument)
      .catch((caught: unknown) => {
        setError(caught);
      })
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  }, []);

  return { start, busy, error };
}
