import {
  applyDecorators,
  createParamDecorator,
  SetMetadata,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";


import { Public } from "../common/auth.guard.js";
import { SkipOriginCheck } from "../common/origin.guard.js";

import { PublishingKeyGuard } from "./publishing-key.guard.js";
import { PublishingRequestLogInterceptor } from "./publishing-request-log.js";

import type { ExecutionContext } from "@nestjs/common";
import type { PublishingContentType, PublishingScope } from "@wasfa/shared/publishing";

/** Who a Publishing API request acts as: the API key (and the admin user who owns it). */
export interface PublishingPrincipal {
  keyId: string;
  keyName: string;
  ownerUserId: string;
  scopes: readonly PublishingScope[];
  canPublish: boolean;
  requireSignature?: boolean;
  /** Empty = every writable type. */
  allowedTypes: readonly PublishingContentType[];
  /** Empty = any category. */
  allowedCategorySlugs: readonly string[];
  defaultAuthorId: string | null;
  defaultFeaturedMediaId: string | null;
  dailyPublishCap: number | null;
  requestsPerMinute: number;
  /** Optional extras (set by the guard): `GET /me` reports them. */
  environment?: "live" | "test";
  expiresAt?: Date;
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
    UseInterceptors(PublishingRequestLogInterceptor),
  );

/** The principal the guard attached (always set on a route decorated with PublishingAuth). */
export const CurrentKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PublishingPrincipal =>
    (context.switchToHttp().getRequest() as Record<string, PublishingPrincipal>)[
      PUBLISHING_REQUEST_KEY
    ] as PublishingPrincipal,
);
