import { it } from "vitest";

/*
 * Red tests for the Phase 6 root causes (docs/WA-AGENT-RUNTIME.md §2). Each one is written as the correct
 * behaviour, so today it fails; `redTest` passes only while it fails for the documented reason. When the
 * owning package fixes the bug the body passes and `redTest` fails, asking for the switch to a plain `it`.
 * A failure for any other reason (a broken harness, a renamed helper) also fails, so a red test can never
 * be "red" by accident.
 */

export interface RedCase {
  /** Root cause id, e.g. "R4". */
  id: `R${number}`;
  /** Package that turns it green, e.g. "WP1". */
  fixedIn: `WP${number}`;
  /** The symptom, in a few words. */
  title: string;
  /** Matches the assertion message of today's failure (the documented reason). */
  reason: RegExp;
}

export function redTest(
  red: RedCase,
  body: () => Promise<void> | void,
  timeoutMs?: number,
): void {
  it(
    `${red.id} ${red.title} [todo-fix(${red.fixedIn})]`,
    async () => {
      let failure: unknown;
      try {
        await body();
      } catch (error) {
        failure = error;
      }
      if (failure === undefined) {
        throw new Error(`${red.id} now passes: replace redTest with it() (fixed in ${red.fixedIn})`);
      }
      const message = failure instanceof Error ? failure.message : String(failure);
      if (!red.reason.test(message)) {
        throw new Error(`${red.id} failed for another reason than ${String(red.reason)}: ${message}`, {
          cause: failure,
        });
      }
    },
    timeoutMs,
  );
}
