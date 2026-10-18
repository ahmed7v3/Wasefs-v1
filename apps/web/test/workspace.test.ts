// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { clearBrowserCookie, parseCookie, serializeCookie } from "../src/lib/browser-cookies";
import {
  WORKSPACE_COOKIE,
  creditsPath,
  getWorkspaceOrgId,
  parseWorkspace,
  setWorkspaceOrgId,
  withWorkspace,
  workspaceFromCookieHeader,
} from "../src/lib/workspace";

const ORG = "00000000-0000-4000-8000-0000000000aa";

afterEach(() => {
  clearBrowserCookie(WORKSPACE_COOKIE);
});

describe("parseWorkspace", () => {
  it("accepts an organization id and nothing else", () => {
    expect(parseWorkspace(ORG)).toBe(ORG);
    expect(parseWorkspace("not-a-uuid")).toBeNull();
    expect(parseWorkspace("")).toBeNull();
    expect(parseWorkspace(undefined)).toBeNull();
    expect(parseWorkspace(null)).toBeNull();
  });
});

describe("cookie text", () => {
  it("writes a 180-day SameSite=Lax cookie for the whole site", () => {
    const text = serializeCookie(WORKSPACE_COOKIE, ORG, { days: 180, secure: true });
    expect(text).toContain(`${WORKSPACE_COOKIE}=${ORG}`);
    expect(text).toContain("Path=/");
    expect(text).toContain(`Max-Age=${String(180 * 86_400)}`);
    expect(text).toContain("SameSite=Lax");
    expect(text).toContain("Secure");
  });

  it("reads one cookie out of a header, ignoring the others", () => {
    expect(parseCookie(`a=1; ${WORKSPACE_COOKIE}=${ORG}; b=2`, WORKSPACE_COOKIE)).toBe(ORG);
    expect(parseCookie("a=1", WORKSPACE_COOKIE)).toBeUndefined();
    expect(parseCookie(null, WORKSPACE_COOKIE)).toBeUndefined();
  });

  it("reads the choice on the server from the Cookie header", () => {
    expect(workspaceFromCookieHeader(`x=1; ${WORKSPACE_COOKIE}=${ORG}`)).toBe(ORG);
    expect(workspaceFromCookieHeader(`${WORKSPACE_COOKIE}=forged`)).toBeNull();
    expect(workspaceFromCookieHeader(undefined)).toBeNull();
  });
});

describe("the browser workspace", () => {
  it("is the personal account until an organization is chosen", () => {
    expect(getWorkspaceOrgId()).toBeNull();
    expect(withWorkspace({ mode: "balanced" })).toEqual({ mode: "balanced" });
    expect(creditsPath(getWorkspaceOrgId())).toBe("/me/credits");
  });

  it("remembers an organization and adds it to request bodies", () => {
    setWorkspaceOrgId(ORG);
    expect(getWorkspaceOrgId()).toBe(ORG);
    expect(withWorkspace({ mode: "balanced" })).toEqual({ mode: "balanced", orgId: ORG });
    expect(creditsPath(ORG)).toBe(`/me/credits?orgId=${ORG}`);
  });

  it("goes back to the personal account when cleared, and ignores a forged cookie", () => {
    setWorkspaceOrgId(ORG);
    setWorkspaceOrgId(null);
    expect(getWorkspaceOrgId()).toBeNull();
    document.cookie = `${WORKSPACE_COOKIE}=forged; path=/`;
    expect(getWorkspaceOrgId()).toBeNull();
    expect(withWorkspace({})).toEqual({});
  });
});
