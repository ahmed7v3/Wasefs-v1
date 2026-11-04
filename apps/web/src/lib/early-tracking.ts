import {
  EARLY_VARIANTS,
  type EarlyClientContext,
  type EarlyEventType,
  type EarlyVariant,
} from "@wasfa/shared/schemas/early-access";

import { publicEnv } from "./env";

/*
 * Browser side of the pre-launch funnel (docs/EARLY-ACCESS-PLAN.md D3). First-party only: a session
 * id and the first-touch campaign data live in sessionStorage; the server adds geo from Cloudflare
 * headers. Everything here is a no-op on the server.
 */

const SESSION_KEY = "ea_sid";
const TOUCH_KEY = "ea_touch";
const FOCUS_KEY = "ea_pf";
const STARTED_KEY = "ea_t0";

const UTM_KEYS = ["source", "medium", "campaign", "content", "term"] as const;

interface FirstTouch {
  utm: Record<string, string>;
  campaign?: string;
  ref?: string;
  referrer?: string;
}

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    // Storage is blocked (private mode in some browsers): the funnel still works, just per page.
    return null;
  }
}

export function getSessionId(): string {
  const s = store();
  const existing = s?.getItem(SESSION_KEY);
  if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
  const id = crypto.randomUUID().replaceAll("-", "");
  s?.setItem(SESSION_KEY, id);
  return id;
}

function readTouch(): FirstTouch | null {
  const raw = store()?.getItem(TOUCH_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as FirstTouch) : null;
  } catch {
    return null;
  }
}

/** Reads `utm_*`, `c` and `r` from the landing URL once; later pages of the session keep the first touch. */
export function captureFirstTouch(): FirstTouch {
  const existing = readTouch();
  if (existing) return existing;
  const params = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = params.get(`utm_${key}`)?.trim();
    if (value) utm[key] = value.slice(0, 150);
  }
  const touch: FirstTouch = { utm };
  const campaign = params.get("c")?.trim().toLowerCase();
  if (campaign && /^[a-z0-9][a-z0-9-]{0,63}$/.test(campaign)) touch.campaign = campaign;
  const ref = params.get("r")?.trim();
  if (ref && /^[A-Za-z0-9]{6,12}$/.test(ref)) touch.ref = ref;
  if (document.referrer) touch.referrer = document.referrer.slice(0, 500);
  store()?.setItem(TOUCH_KEY, JSON.stringify(touch));
  return touch;
}

let variant: EarlyVariant | undefined;

/** Called once by the page with the variant the server rendered. */
export function setTrackedVariant(value: string | null | undefined): void {
  variant = (EARLY_VARIANTS as readonly string[]).includes(value ?? "")
    ? (value as EarlyVariant)
    : undefined;
}

/** Everything the API wants besides the event/join payload itself. */
export function clientContext(): EarlyClientContext {
  const touch = captureFirstTouch();
  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timezone = undefined;
  }
  return {
    sessionId: getSessionId(),
    utm: touch.utm,
    ...(touch.campaign ? { campaign: touch.campaign } : {}),
    ...(touch.ref ? { ref: touch.ref } : {}),
    ...(touch.referrer ? { referrer: touch.referrer } : {}),
    ...(timezone ? { timezone } : {}),
    ...(navigator.language ? { lang: navigator.language.slice(0, 35) } : {}),
    ...(variant ? { variant } : {}),
    screenW: Math.round(window.innerWidth),
  };
}

/** Milliseconds since the first view of this session (informational `elapsedMs` of the join). */
export function elapsedSinceStart(): number {
  const s = store();
  const raw = s?.getItem(STARTED_KEY);
  const started = raw ? Number(raw) : Date.now();
  if (!raw) s?.setItem(STARTED_KEY, String(started));
  return Math.max(0, Math.min(86_400_000, Date.now() - started));
}

const once = new Set<EarlyEventType>();

/** Fire-and-forget funnel event; `sendBeacon` survives navigation, `fetch keepalive` is the fallback. */
export function ping(type: EarlyEventType): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({ ...clientContext(), type });
  const url = `${publicEnv.NEXT_PUBLIC_API_URL}/public/early-access/ping`;
  try {
    // A string body goes out as text/plain, which needs no CORS preflight.
    if (navigator.sendBeacon(url, body)) return;
  } catch {
    // Fall through to fetch.
  }
  void fetch(url, {
    method: "POST",
    body,
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    keepalive: true,
    mode: "cors",
    credentials: "omit",
  }).catch(() => undefined);
}

/** Fires `type` at most once per page load (React strict mode runs effects twice in dev). */
export function pingOnce(type: EarlyEventType): void {
  if (once.has(type)) return;
  once.add(type);
  ping(type);
}

/** `phone_focus` counts the first focus of the session, not every re-focus. */
export function pingPhoneFocus(): void {
  const s = store();
  if (s?.getItem(FOCUS_KEY)) return;
  s?.setItem(FOCUS_KEY, "1");
  ping("phone_focus");
}
