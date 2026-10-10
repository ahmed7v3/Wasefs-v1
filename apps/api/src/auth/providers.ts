import {
  PROVIDER_IDS,
  type AuthSettings,
  type ProviderId,
  type ProviderStatus,
} from "@wasfa/shared/auth-settings";

import type { ApiEnv } from "../config/env.js";

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

/** Credentials from env; `undefined` when the provider has no keys (it can then never be enabled). */
export function providerCredentials(env: ApiEnv, id: ProviderId): ProviderCredentials | undefined {
  const [clientId, clientSecret] =
    id === "google"
      ? [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET]
      : [env.FACEBOOK_CLIENT_ID, env.FACEBOOK_CLIENT_SECRET];
  return clientId !== undefined && clientSecret !== undefined
    ? { clientId, clientSecret }
    : undefined;
}

export interface ProviderState {
  id: ProviderId;
  status: ProviderStatus;
}

/**
 * The registry the web buttons are drawn from. A provider is `enabled` only when the admin setting
 * says so **and** its keys exist; otherwise an `enabled` setting degrades to `disabled`.
 * `coming_soon` is shown as a visible, disabled button with a badge.
 */
export function providerStates(env: ApiEnv, settings: AuthSettings): ProviderState[] {
  return PROVIDER_IDS.map((id) => {
    const wanted = settings.providers[id];
    const status: ProviderStatus =
      wanted === "enabled" && providerCredentials(env, id) === undefined ? "disabled" : wanted;
    return { id, status };
  });
}

export function isProviderEnabled(env: ApiEnv, settings: AuthSettings, id: string): boolean {
  return providerStates(env, settings).some(
    (state) => state.id === id && state.status === "enabled",
  );
}
