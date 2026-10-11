import { skipTurnstile } from "./support/config";
import { startStack } from "./support/stack";

/** Starts the stack once per run and hands its addresses to the workers through the environment. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const stack = await startStack({ withTurnstile: !skipTurnstile() });
  process.env["E2E_RUNTIME"] = JSON.stringify(stack.runtime);
  return stack.stop;
}
