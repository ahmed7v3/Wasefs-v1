"use client";

import {
  adminEarlyLinkCreateSchema,
  adminEarlyLinkSchema,
  adminEarlyOverviewSchema,
  type AdminEarlyLink,
} from "@wasfa/shared/schemas/early-access";
import { Button, Card, Field, Input, Select, Skeleton, useToast } from "@wasfa/ui";
import { ArrowDownUp, Copy, Download, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { formatNumber } from "../../../lib/admin-format";
import { api } from "../../../lib/api-client";
import { useResource } from "../../../lib/use-admin-data";
import { ErrorNotice } from "../../error-notice";

import { formatPercent, percent } from "./chart-math";
import { SOURCE_PRESETS, T } from "./labels";

import type { EarlyFilters } from "./filters";

export const EARLY_ORIGIN = "https://early.wasfa.online";

/** Latin slug from a name; an Arabic-only name gives "" and the admin types the slug. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

type SortKey = "name" | "slug" | "views" | "signups" | "completed" | "cr";

interface CampaignRow {
  id: string | null;
  name: string;
  slug: string;
  views: number;
  signups: number;
  completed: number;
  cr: number;
  link: AdminEarlyLink | undefined;
}

async function downloadQr(url: string, slug: string) {
  const qr = await import("qrcode");
  const dataUrl = await qr.toDataURL(url, { margin: 2, width: 768 });
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `early-${slug}.png`;
  document.body.append(link);
  link.click();
  link.remove();
}

function CreatedLink({ url, slug }: { url: string; slug: string }) {
  const { toast } = useToast();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-success/40 bg-success-soft p-4">
      <div className="flex min-w-0 flex-col gap-2">
        <p className="font-semibold text-text">{T.campaigns.created}</p>
        <p className="text-sm text-text-muted">{T.campaigns.finalUrl}</p>
        <bdi dir="ltr" className="break-all text-base text-text">
          {url}
        </bdi>
      </div>
      <div className="flex flex-wrap gap-2 ms-auto">
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => {
              toast({ tone: "success", title: T.campaigns.copied });
            });
          }}
        >
          <Copy aria-hidden className="size-4" />
          {T.campaigns.copy}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            void downloadQr(url, slug).catch(() => {
              toast({ tone: "error", title: T.campaigns.failed });
            });
          }}
        >
          <Download aria-hidden className="size-4" />
          {T.campaigns.qr}
        </Button>
      </div>
    </div>
  );
}

function NewLinkForm({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [utm, setUtm] = useState({ source: "", medium: "", campaign: "", content: "", term: "" });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<AdminEarlyLink | null>(null);

  const setField = (field: keyof typeof utm) => (value: string) => {
    setUtm((current) => ({ ...current, [field]: value }));
  };

  const submit = async () => {
    const cleaned = Object.fromEntries(
      Object.entries(utm)
        .map(([key, value]) => [key, value.trim()] as const)
        .filter(([, value]) => value !== ""),
    );
    const parsed = adminEarlyLinkCreateSchema.safeParse({ name, slug, utm: cleaned });
    if (!parsed.success) {
      toast({ tone: "error", title: T.campaigns.failed });
      return;
    }
    setBusy(true);
    try {
      const link = await api("/admin/early-access/links", {
        method: "POST",
        body: parsed.data,
        schema: adminEarlyLinkSchema,
      });
      setCreated(link);
      onCreated();
    } catch {
      toast({ tone: "error", title: T.campaigns.failed });
    } finally {
      setBusy(false);
    }
  };

  const utmFields = [
    ["source", T.campaigns.utmSource],
    ["medium", T.campaigns.utmMedium],
    ["campaign", T.campaigns.utmCampaign],
    ["content", T.campaigns.utmContent],
    ["term", T.campaigns.utmTerm],
  ] as const;

  return (
    <Card elevation="flat" className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={T.campaigns.nameField} required>
          {(control) => (
            <Input
              {...control}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!slugTouched) setSlug(slugify(event.target.value));
              }}
            />
          )}
        </Field>
        <Field label={T.campaigns.slugField} required>
          {(control) => (
            <Input
              {...control}
              ltr
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value.toLowerCase());
              }}
            />
          )}
        </Field>
        <Field label={T.campaigns.preset}>
          {(control) => (
            <Select
              {...control}
              value=""
              onChange={(event) => {
                const preset = SOURCE_PRESETS.find((p) => p.id === event.target.value);
                if (preset) {
                  setUtm((current) => ({
                    ...current,
                    source: preset.utm.source,
                    medium: preset.utm.medium,
                    campaign: current.campaign || slug,
                  }));
                }
              }}
            >
              <option value="">—</option>
              {SOURCE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {utmFields.map(([key, label]) => (
          <Field key={key} label={label}>
            {(control) => <Input {...control} ltr value={utm[key]} onChange={(e) => { setField(key)(e.target.value); }} />}
          </Field>
        ))}
      </div>
      <p className="text-sm text-text-muted">
        {T.campaigns.finalUrl}: <bdi dir="ltr">{`${EARLY_ORIGIN}/c/${slug || "…"}`}</bdi>
      </p>
      <div>
        <Button disabled={busy || name.trim().length < 2 || slug === ""} onClick={() => void submit()}>
          <Plus aria-hidden className="size-4" />
          {T.campaigns.create}
        </Button>
      </div>
      {created ? <CreatedLink url={`${EARLY_ORIGIN}/c/${created.slug}`} slug={created.slug} /> : null}
    </Card>
  );
}

export function CampaignsPanel({
  filters,
  links,
  reloadLinks,
}: {
  filters: EarlyFilters;
  links: readonly AdminEarlyLink[];
  reloadLinks: () => void;
}) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "signups",
    dir: "desc",
  });
  const [shown, setShown] = useState<{ url: string; slug: string } | null>(null);
  // Campaign stats follow the date and other filters, except the campaign itself (all rows show).
  const statsQuery = new URLSearchParams(
    Object.entries({ ...filters.params, campaignLinkId: undefined }).flatMap(([k, v]) =>
      v ? [[k, v] as [string, string]] : [],
    ),
  ).toString();
  const resource = useResource(
    `/admin/early-access/overview${statsQuery ? `?${statsQuery}` : ""}`,
    adminEarlyOverviewSchema,
  );

  const rows = useMemo<CampaignRow[]>(() => {
    if (resource.status !== "ready") return [];
    const stats = new Map(resource.data.campaigns.map((c) => [c.campaignLinkId, c]));
    const out: CampaignRow[] = links.map((link) => {
      const s = stats.get(link.id);
      const views = s?.views ?? 0;
      const completed = s?.completed ?? 0;
      return {
        id: link.id,
        name: link.name,
        slug: link.slug,
        views,
        signups: s?.signups ?? 0,
        completed,
        cr: percent(completed, views),
        link,
      };
    });
    const direct = stats.get(null);
    if (direct) {
      out.push({
        id: null,
        name: T.campaigns.direct,
        slug: "—",
        views: direct.views,
        signups: direct.signups,
        completed: direct.completed,
        cr: percent(direct.completed, direct.views),
        link: undefined,
      });
    }
    const factor = sort.dir === "asc" ? 1 : -1;
    return out.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      return (typeof av === "string" ? av.localeCompare(bv as string, "ar") : (av as number) - (bv as number)) * factor;
    });
  }, [resource, links, sort]);

  const toggleActive = async (link: AdminEarlyLink) => {
    try {
      await api(`/admin/early-access/links/${link.id}`, {
        method: "PATCH",
        body: { active: !link.active },
      });
      reloadLinks();
    } catch {
      toast({ tone: "error", title: T.campaigns.failed });
    }
  };

  const header = (key: SortKey, label: string) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className="py-2 text-start font-semibold">
      <button
        type="button"
        className="inline-flex items-center gap-1 focus-visible:outline-none focus-visible:shadow-focus"
        onClick={() => {
          setSort((current) => ({
            key,
            dir: current.key === key && current.dir === "desc" ? "asc" : "desc",
          }));
        }}
      >
        {label}
        <ArrowDownUp aria-hidden className="size-3.5" />
      </button>
    </th>
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button
          variant={showForm ? "secondary" : "primary"}
          onClick={() => {
            setShowForm((current) => !current);
          }}
        >
          <Plus aria-hidden className="size-4" />
          {showForm ? T.campaigns.cancel : T.campaigns.new}
        </Button>
      </div>
      {showForm ? <NewLinkForm onCreated={reloadLinks} /> : null}
      {resource.status === "loading" ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <p className="sr-only" role="status">
            {T.loading}
          </p>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : resource.status === "error" ? (
        <ErrorNotice error={resource.error} onRetry={resource.reload} />
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-text-muted">{T.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[40rem] text-base tabular-nums">
            <caption className="sr-only">{T.campaigns.links}</caption>
            <thead className="text-sm text-text-muted">
              <tr>
                {header("name", T.campaigns.name)}
                {header("slug", T.campaigns.slug)}
                {header("views", T.campaigns.views)}
                {header("signups", T.campaigns.signups)}
                {header("completed", T.campaigns.completed)}
                {header("cr", T.campaigns.cr)}
                <th scope="col" className="py-2 text-start font-semibold">{T.campaigns.active}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id ?? "direct"} className="border-t border-border">
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="px-3 py-2">
                    {row.link ? (
                      <button
                        type="button"
                        className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                        onClick={() => {
                          setShown({ url: `${EARLY_ORIGIN}/c/${row.slug}`, slug: row.slug });
                        }}
                      >
                        <bdi dir="ltr">{row.slug}</bdi>
                      </button>
                    ) : (
                      row.slug
                    )}
                  </td>
                  <td className="px-3 py-2">{formatNumber(row.views)}</td>
                  <td className="px-3 py-2">{formatNumber(row.signups)}</td>
                  <td className="px-3 py-2">{formatNumber(row.completed)}</td>
                  <td className="px-3 py-2">{formatPercent(row.cr)}</td>
                  <td className="px-3 py-2">
                    {row.link ? (
                      <span className="inline-flex items-center gap-2">
                        <span className={row.link.active ? "text-success" : "text-text-muted"}>
                          {row.link.active ? T.campaigns.on : T.campaigns.off}
                        </span>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (row.link) void toggleActive(row.link);
                        }}
                      >
                        {row.link.active ? T.campaigns.deactivate : T.campaigns.activate}
                      </Button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown ? <CreatedLink url={shown.url} slug={shown.slug} /> : null}
    </div>
  );
}
