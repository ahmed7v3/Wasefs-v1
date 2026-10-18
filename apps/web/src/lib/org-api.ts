import {
  joinAcceptResponseSchema,
  joinLinkItemSchema,
  type JoinAcceptResponse,
  type JoinLinkItem,
} from "@wasfa/shared/schemas/org";
import { myOrdersResponseSchema, type MyOrdersResponse } from "@wasfa/shared/schemas/subscriptions";

import { api } from "./api-client";

import type { CreateJoinLinkInput } from "@wasfa/shared/schemas/deals";

/*
 * Browser calls of the organization screens. Every answer is parsed with the shared schema; the
 * API decides who may do what (an org admin), so a button shown to a non-admin only gets a refusal.
 */

export const orgDashboardPath = (orgId: string): string => `/orgs/${orgId}/dashboard`;
export const orgJoinLinksPath = (orgId: string): string => `/orgs/${orgId}/join-links`;

export function createJoinLink(
  orgId: string,
  input: Partial<CreateJoinLinkInput> & Pick<CreateJoinLinkInput, "slug">,
): Promise<JoinLinkItem> {
  return api(orgJoinLinksPath(orgId), { method: "POST", body: input, schema: joinLinkItemSchema });
}

export function disableJoinLink(orgId: string, linkId: string): Promise<JoinLinkItem> {
  return api(`${orgJoinLinksPath(orgId)}/${linkId}/disable`, {
    method: "POST",
    body: {},
    schema: joinLinkItemSchema,
  });
}

export function approveMember(orgId: string, userId: string): Promise<unknown> {
  return api(`/orgs/${orgId}/members/${userId}/approve`, { method: "POST", body: {} });
}

export function rejectMember(orgId: string, userId: string): Promise<unknown> {
  return api(`/orgs/${orgId}/members/${userId}/reject`, { method: "POST", body: {} });
}

/** `null` removes the monthly cap. */
export function setMemberCap(
  orgId: string,
  userId: string,
  monthlyCreditCap: number | null,
): Promise<unknown> {
  return api(`/orgs/${orgId}/members/${userId}/limit`, {
    method: "PUT",
    body: { monthlyCreditCap },
  });
}

export function fetchOrgOrders(orgId: string, cursor?: string): Promise<MyOrdersResponse> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return api(`/orgs/${orgId}/orders${query}`, { schema: myOrdersResponseSchema });
}

export function acceptJoin(slug: string): Promise<JoinAcceptResponse> {
  return api(`/join/${encodeURIComponent(slug)}/accept`, {
    method: "POST",
    body: {},
    schema: joinAcceptResponseSchema,
  });
}
