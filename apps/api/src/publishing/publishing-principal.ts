import { applyDecorators, createParamDecorator, SetMetadata, UseGuards } from "@nestjs/common";

import type { ExecutionContext } from "@nestjs/common";
import type {
  PublishingContentType,
  PublishingScope,
} from "@wasfa/shared/publishing";

import { Public } from "../common/auth.guard.js";
import { SkipOriginCheck } from "../common/origin.guard.js";

import { PublishingKeyGuard } from "./publishing-key.guard.js";

/** Who a Publishing API request acts as: the API key (and the admin user who owns it). */
export interface PublishingPrincipal {
  keyId: string;
  keyName: string;
  ownerUserId: string;
  scopes: readonly PublishingScope[];
  canPublish: boolean;
  /** Empty = every writable type. */
  allowedTypes: readonly PublishingContentType[];
  /** Empty = any category. */
  allowedCategorySlugs: readonly string[];
  defaultAuthorId: string | null;
  defaultFeaturedMediaId: string | null;
  dailyPublishCap: number | null;
  requestsPerMinute: number;
}

export const PUBLISHING_SCOPES_KEY = "publishing:scopes";
export const PUBLISHING_REQUEST_KEY = "publishingPrincipal";

/**
 * Put on every Publishing API route: no browser session, no origin check, the Bearer key is the
 * credential and `scopes` are required of it (an empty list = any valid key, e.g. GET /me).
 * The guard (PublishingKeyGuard) authenticates, enforces scopes, IP allow-list, per-key rate limit,
 * records the request log and attaches the principal to the request.
 */
export const PublishingAuth = (...scopes: PublishingScope[]) =>
  applyDecorators(
    Public(),
    SkipOriginCheck(),
    SetMetadata(PUBLISHING_SCOPES_KEY, scopes),
    UseGuards(PublishingKeyGuard),
  );

/** The principal the guard attached (always set on a route decorated with PublishingAuth). */
export const CurrentKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PublishingPrincipal =>
    (context.switchToHttp().getRequest() as Record<string, PublishingPrincipal>)[
      PUBLISHING_REQUEST_KEY
    ] as PublishingPrincipal,
);
