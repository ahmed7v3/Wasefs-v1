import type { StackName } from "./config";
import type { RuntimeInfo } from "./stack";

/** What `global-setup` started, as the workers see it. */
export function runtime(): RuntimeInfo {
  const raw = process.env["E2E_RUNTIME"];
  if (!raw) throw new Error("E2E_RUNTIME is not set: global setup did not run");
  return JSON.parse(raw) as RuntimeInfo;
}

export interface StackUrls {
  web: string;
  api: string;
}

export function stackUrls(name: StackName): StackUrls {
  const urls = runtime().stacks[name];
  if (!urls) throw new Error(`The "${name}" stack is not running`);
  return urls;
}
