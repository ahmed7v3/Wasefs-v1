/*
 * A deliberately small user-agent reader for the sessions list: "Chrome on Windows" is all a person
 * needs to recognise (or not recognise) a device. It is not a general parser; anything unknown is
 * reported as `null` and the UI says "unknown device".
 */

export interface DeviceInfo {
  browser: string | null;
  os: string | null;
}

// Order matters: Edge, Opera and Samsung Browser also say "Chrome"; Chrome also says "Safari".
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\b(?:OPR|Opera)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bCriOS\/|Chrome\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

// iOS before macOS (iPad and iPhone UAs say "like Mac OS X"); Android before Linux.
const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:iPhone|iPad|iPod)\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bLinux\b/, "Linux"],
];

function firstMatch(userAgent: string, table: ReadonlyArray<readonly [RegExp, string]>) {
  return table.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;
}

export function parseUserAgent(userAgent: string | null | undefined): DeviceInfo {
  if (!userAgent) return { browser: null, os: null };
  return { browser: firstMatch(userAgent, BROWSERS), os: firstMatch(userAgent, SYSTEMS) };
}
