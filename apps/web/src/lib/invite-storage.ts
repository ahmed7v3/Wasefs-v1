/*
 * The invitation token lives in the URL fragment (`/invite#<token>`), which never reaches a server
 * or a log. The page moves it into `sessionStorage` and clears the fragment, so a sign-in or
 * registration detour (full page loads) does not lose it, and so it does not stay in history.
 */

export const INVITE_STORAGE_KEY = "wasfa.invite";

/** The token shape the API accepts (`acceptInviteTokenSchema`): 43 base64url characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isInviteToken(value: string | null | undefined): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export function readStoredInviteToken(): string | null {
  try {
    const stored = sessionStorage.getItem(INVITE_STORAGE_KEY);
    return isInviteToken(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function storeInviteToken(token: string): void {
  try {
    sessionStorage.setItem(INVITE_STORAGE_KEY, token);
  } catch {
    /* storage blocked: the token stays in memory for this page only */
  }
}

export function clearStoredInviteToken(): void {
  try {
    sessionStorage.removeItem(INVITE_STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Picks the token up from the fragment (storing it and clearing the fragment), else from storage.
 * Returns `null` when there is none.
 */
export function takeInviteToken(): string | null {
  const fromHash = window.location.hash.replace(/^#/, "");
  if (isInviteToken(fromHash)) {
    storeInviteToken(fromHash);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    return fromHash;
  }
  return readStoredInviteToken();
}
