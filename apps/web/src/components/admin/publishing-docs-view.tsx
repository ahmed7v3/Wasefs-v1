"use client";

import { t } from "@wasfa/shared/i18n";
import {
  publishingOpenApiSchema,
  type PublishingOpenApiDocument,
  type PublishingOpenApiOperation,
} from "@wasfa/shared/schemas/publishing-openapi";
import { Badge, Button, Card, CardTitle, Input } from "@wasfa/ui";
import { BookOpen, KeyRound, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { publishingBaseUrl } from "../../lib/publishing-admin";

const METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "trace"] as const;
type HttpMethod = (typeof METHODS)[number];
type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; document: PublishingOpenApiDocument };
type Route = { method: HttpMethod; path: string; operation: PublishingOpenApiOperation };

function jsonText(value: unknown): string {
  if (value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2) ?? "—";
  } catch {
    return "—";
  }
}

function useOpenApi(url: string): { state: LoadState; retry: () => void } {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetch(url, {
      signal: controller.signal,
      credentials: "omit",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        const raw: unknown = await response.json();
        const parsed = publishingOpenApiSchema.safeParse(raw);
        if (!parsed.success) throw new Error("invalid document");
        setState({ status: "ready", document: parsed.data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => controller.abort();
  }, [url, attempt]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  return { state, retry };
}

function RouteCard({ route }: { route: Route }) {
  const operation = route.operation;
  const scope = operation["x-required-scope"];
  const publicRoute = operation.security?.length === 0;
  const parameters = operation.parameters ?? [];
  const bodyEntries = Object.entries(operation.requestBody?.content ?? {});
  const successes = Object.entries(operation.responses).filter(([status]) => /^2\d\d$/.test(status));

  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
      <details>
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <Badge tone={route.method === "get" ? "info" : route.method === "delete" ? "danger" : "neutral"}>
            <bdi dir="ltr">{route.method.toUpperCase()}</bdi>
          </Badge>
          <bdi dir="ltr" className="min-w-0 flex-1 break-all font-mono text-sm font-semibold text-text">
            {route.path}
          </bdi>
          <span className="w-full text-sm text-text-muted sm:w-auto sm:flex-1">{operation.summary}</span>
        </summary>
        <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="font-semibold">{t("admin.pub.docs.auth")}:</span>
            <Badge tone={publicRoute ? "success" : "neutral"}>
              {publicRoute ? t("admin.pub.docs.authPublic") : t("admin.pub.docs.authRequired")}
            </Badge>
            <span className="font-semibold">{t("admin.pub.docs.scope")}:</span>
            {scope ? (
              <Badge tone="warning"><bdi dir="ltr">{scope}</bdi></Badge>
            ) : (
              <span className="text-text-muted">{t("admin.pub.docs.noScope")}</span>
            )}
          </div>

          {parameters.length > 0 ? (
            <section className="flex flex-col gap-2" aria-label={t("admin.pub.docs.parameters")}>
              <h3 className="font-semibold text-text">{t("admin.pub.docs.parameters")}</h3>
              <ul className="flex flex-col gap-2">
                {parameters.map((parameter, index) => (
                  <li key={`${parameter.in}-${parameter.name}-${index}`} className="rounded-md bg-surface-muted p-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <bdi dir="ltr" className="font-mono font-semibold">{parameter.name}</bdi>
                      <Badge tone="neutral">{parameter.in}</Badge>
                      <span className="text-text-muted">
                        {parameter.required ? t("admin.pub.docs.required") : t("admin.pub.docs.optional")}
                      </span>
                      {parameter.description ? <span className="text-text-muted">{parameter.description}</span> : null}
                    </div>
                    {parameter.schema !== undefined ? <SchemaBlock value={parameter.schema} /> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {parameters.length === 0 ? <p className="text-sm text-text-muted">{t("admin.pub.docs.noParameters")}</p> : null}

          <section className="flex flex-col gap-2" aria-label={t("admin.pub.docs.requestBody")}>
            <h3 className="font-semibold text-text">{t("admin.pub.docs.requestBody")}</h3>
            {bodyEntries.length ? (
              bodyEntries.map(([contentType, media]) => (
                <div key={contentType} className="flex flex-col gap-2">
                  <p className="text-sm text-text-muted">
                    <bdi dir="ltr">{contentType}</bdi>
                    {operation.requestBody?.required ? ` · ${t("admin.pub.docs.required")}` : ` · ${t("admin.pub.docs.optional")}`}
                  </p>
                  <SchemaBlock value={media.schema} />
                </div>
              ))
            ) : (
              <p className="text-sm text-text-muted">{t("admin.pub.docs.noRequestBody")}</p>
            )}
          </section>

          <section className="flex flex-col gap-2" aria-label={t("admin.pub.docs.successResponses")}>
            <h3 className="font-semibold text-text">{t("admin.pub.docs.successResponses")}</h3>
            {successes.length ? (
              successes.map(([status, response]) => (
                <div key={status} className="flex flex-col gap-2 rounded-md bg-surface-muted p-3">
                  <p className="flex flex-wrap gap-2 text-sm">
                    <bdi dir="ltr" className="font-mono font-semibold">{status}</bdi>
                    {response.description ? <span className="text-text-muted">{response.description}</span> : null}
                  </p>
                  {Object.entries(response.content ?? {}).map(([contentType, media]) => (
                    <div key={contentType} className="flex flex-col gap-2">
                      <bdi dir="ltr" className="text-xs text-text-muted">{contentType}</bdi>
                      <SchemaBlock value={media.schema} />
                    </div>
                  ))}
                </div>
              ))
            ) : (
              <p className="text-sm text-text-muted">{t("admin.pub.docs.noSuccessResponses")}</p>
            )}
          </section>
        </div>
      </details>
    </Card>
  );
}

function SchemaBlock({ value }: { value: unknown }) {
  return (
    <pre dir="ltr" className="mt-2 max-h-72 overflow-auto rounded-md bg-surface p-3 text-start text-xs leading-5 text-text">
      <code>{jsonText(value)}</code>
    </pre>
  );
}

/** `/admin/content/api/docs`: live, searchable reference for the public Publishing API spec. */
export function PublishingDocsView() {
  const base = publishingBaseUrl();
  const { state, retry } = useOpenApi(`${base}/openapi.json`);
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState("");
  const [scope, setScope] = useState("");

  const routes = useMemo(() => {
    if (state.status !== "ready") return [];
    return Object.entries(state.document.paths).flatMap(([path, item]) =>
      METHODS.flatMap((verb) => {
        const operation = item[verb];
        return operation ? [{ method: verb, path, operation }] : [];
      }),
    );
  }, [state]);
  const scopes = useMemo(
    () => [...new Set(routes.map((route) => route.operation["x-required-scope"]).filter((value): value is string => Boolean(value)))].sort(),
    [routes],
  );
  const filtered = routes.filter((route) => {
    const text = `${route.method} ${route.path} ${route.operation.summary} ${route.operation["x-required-scope"] ?? ""}`.toLocaleLowerCase();
    return (!query || text.includes(query.trim().toLocaleLowerCase())) && (!method || route.method === method) && (!scope || route.operation["x-required-scope"] === scope);
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">{t("admin.pub.docs.title")}</h1>
          <p className="mt-1 text-sm text-text-muted">{t("admin.pub.docs.intro")}</p>
        </div>
        <nav aria-label={t("admin.pub.docs.title")} className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/admin/content/api" className="inline-flex items-center gap-2 font-semibold text-primary underline">
            <BookOpen aria-hidden className="size-4" />{t("admin.pub.docs.connectLink")}
          </Link>
          <Link href="/admin/content/api-keys" className="inline-flex items-center gap-2 font-semibold text-primary underline">
            <KeyRound aria-hidden className="size-4" />{t("admin.pub.docs.keysLink")}
          </Link>
        </nav>
      </div>

      <Card elevation="flat" padding="compact" className="flex flex-col gap-4">
        <CardTitle>{t("admin.pub.docs.baseUrl")}</CardTitle>
        <bdi dir="ltr" className="block overflow-x-auto rounded-md bg-surface-muted p-3 text-start font-mono text-sm">{base}</bdi>
        <p className="text-xs text-text-muted">
          {state.status === "ready" ? t("admin.pub.docs.version", { version: state.document.info.version }) : ""}
        </p>
        {state.status === "ready" ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm font-semibold text-text">
              {t("admin.pub.docs.searchLabel")}
              <span className="relative">
                <Search aria-hidden className="pointer-events-none absolute start-3 top-3 size-4 text-text-muted" />
                <Input name="route-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("admin.pub.docs.searchPlaceholder")} className="ps-9" />
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold text-text">
              {t("admin.pub.docs.methodFilter")}
              <select className="min-h-11 rounded-md border border-border bg-surface px-3 text-base" value={method} onChange={(event) => setMethod(event.target.value)}>
                <option value="">{t("admin.pub.docs.methodAll")}</option>
                {METHODS.filter((verb) => routes.some((route) => route.method === verb)).map((verb) => (
                  <option key={verb} value={verb}>{verb.toUpperCase()}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold text-text">
              {t("admin.pub.docs.scopeFilter")}
              <select className="min-h-11 rounded-md border border-border bg-surface px-3 text-base" value={scope} onChange={(event) => setScope(event.target.value)}>
                <option value="">{t("admin.pub.docs.scopeAll")}</option>
                {scopes.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>
        ) : null}
      </Card>

      {state.status === "loading" ? <p role="status" className="text-base text-text-muted">{t("admin.pub.docs.loading")}</p> : null}
      {state.status === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-base text-danger">{t("admin.pub.docs.error")}</p>
          <Button type="button" variant="secondary" name="retry-openapi" onClick={retry}>{t("admin.pub.docs.retry")}</Button>
        </div>
      ) : null}
      {state.status === "ready" ? (
        <section aria-label={t("admin.pub.docs.title")} className="flex flex-col gap-3">
          <p className="text-sm text-text-muted" role="status">{t("admin.pub.docs.routesCount", { count: filtered.length })}</p>
          {filtered.length ? filtered.map((route) => <RouteCard key={`${route.method}:${route.path}`} route={route} />) : (
            <Card elevation="flat" padding="compact"><p className="text-sm text-text-muted">{t("admin.pub.docs.noResults")}</p></Card>
          )}
        </section>
      ) : null}
    </div>
  );
}
