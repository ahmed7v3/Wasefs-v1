import { PUBLISHING_API_BASE } from "@wasfa/shared/publishing";

/*
 * Route TEMPLATES of the Publishing API as Fastify reports them (`request.routeOptions.url`, ids as
 * `:param`): what `publishing_api_requests.route` stores and what the per-key usage counters match on.
 * Publishing controllers (P2) must declare exactly these paths so the counters stay right.
 */
const ARTICLES = `${PUBLISHING_API_BASE}/articles`;

export const PUBLISHING_ROUTES = {
  me: `${PUBLISHING_API_BASE}/me`,
  articles: ARTICLES,
  articleByExternalId: `${ARTICLES}/by-external-id/:externalId`,
  article: `${ARTICLES}/:id`,
  articlePublish: `${ARTICLES}/:id/publish`,
  articleSchedule: `${ARTICLES}/:id/schedule`,
  articleBatch: `${ARTICLES}/batch`,
} as const;

/** Calls that create an item: POST /articles and PUT by external id (a repeat only updates, still counted as an upper bound). */
export const PUBLISHING_CREATE_ROUTES: readonly { method: string; route: string }[] = [
  { method: "POST", route: PUBLISHING_ROUTES.articles },
  { method: "PUT", route: PUBLISHING_ROUTES.articleByExternalId },
  { method: "POST", route: PUBLISHING_ROUTES.articleBatch },
];

/** Calls that publish or schedule an item; counted when they answered 2xx. */
export const PUBLISHING_PUBLISH_ROUTES: readonly { method: string; route: string }[] = [
  { method: "POST", route: PUBLISHING_ROUTES.articlePublish },
  { method: "POST", route: PUBLISHING_ROUTES.articleSchedule },
];
