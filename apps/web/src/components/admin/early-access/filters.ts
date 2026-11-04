"use client";

import {
  ARAB_COUNTRIES,
  EARLY_DEVICES,
  EARLY_ROLES,
  adminEarlyLinkSchema,
  type AdminEarlyLink,
} from "@wasfa/shared/schemas/early-access";
import { useMemo } from "react";
import { z } from "zod";

import { dayBoundary } from "../../../lib/admin-format";
import { buildQuery, useResource } from "../../../lib/use-admin-data";
import { useUrlParams } from "../../../lib/use-url-params";

import { DEVICE_LABEL, RANGE_LABEL, ROLE_LABEL, T } from "./labels";

import type { FilterField } from "../filter-bar";

export type RangeKey = keyof typeof RANGE_LABEL;

/** `GET /admin/early-access/links`: the API answers a bare array or `{ items }`; both are accepted. */
export const linksResponseSchema = z
  .union([z.array(adminEarlyLinkSchema), z.object({ items: z.array(adminEarlyLinkSchema) })])
  .transform((value) => (Array.isArray(value) ? value : value.items));

export function useEarlyLinks() {
  return useResource("/admin/early-access/links", linksResponseSchema);
}

const DAY_MS = 86_400_000;

function utcDay(offsetDays: number): string {
  return new Date(Date.now() - offsetDays * DAY_MS).toISOString().slice(0, 10);
}

export interface EarlyFilters {
  range: RangeKey;
  /** Query string of the shared filters (`from`, `to`, campaign, country, ...) for every API call. */
  query: string;
  /** The same as a record (to extend with list params). */
  params: Record<string, string | undefined>;
  country: string;
}

/** The filter bar's URL params turned into the API filter query; presets use whole UTC days. */
export function useEarlyFilters(): EarlyFilters {
  const url = useUrlParams();
  const rangeParam = url.get("range");
  const range: RangeKey = rangeParam in RANGE_LABEL ? (rangeParam as RangeKey) : "30d";
  const d1 = url.get("d1");
  const d2 = url.get("d2");
  const campaign = url.get("campaign");
  const country = url.get("country");
  const city = url.get("city");
  const role = url.get("role");
  const device = url.get("device");
  const source = url.get("source");

  return useMemo(() => {
    let from: string | undefined;
    let to: string | undefined;
    if (range === "today") from = dayBoundary(utcDay(0), "start");
    else if (range === "7d") from = dayBoundary(utcDay(6), "start");
    else if (range === "30d") from = dayBoundary(utcDay(29), "start");
    else {
      from = dayBoundary(d1, "start");
      to = dayBoundary(d2, "end");
    }
    const params = {
      from,
      to,
      campaignLinkId: campaign,
      country,
      city,
      role,
      device,
      utmSource: source,
    };
    return { range, query: buildQuery(params), params, country };
  }, [range, d1, d2, campaign, country, city, role, device, source]);
}

/** Filter-bar fields; the campaign options come from the links list. */
export function filterFields(
  links: readonly AdminEarlyLink[],
  range: RangeKey,
): readonly FilterField[] {
  const fields: FilterField[] = [];
  if (range === "custom") {
    fields.push({ kind: "date", name: "d1", label: T.filters.from });
    fields.push({ kind: "date", name: "d2", label: T.filters.to });
  }
  fields.push(
    {
      kind: "select",
      name: "campaign",
      label: T.filters.campaign,
      allLabel: T.filters.allCampaigns,
      options: links.map((link) => ({ value: link.id, label: link.name })),
    },
    {
      kind: "select",
      name: "country",
      label: T.filters.country,
      allLabel: T.filters.allCountries,
      options: ARAB_COUNTRIES.map((c) => ({ value: c.iso, label: c.nameAr })),
    },
    { kind: "text", name: "city", label: T.filters.city },
    {
      kind: "select",
      name: "role",
      label: T.filters.role,
      allLabel: T.filters.allRoles,
      options: EARLY_ROLES.map((value) => ({ value, label: ROLE_LABEL[value] })),
    },
    {
      kind: "select",
      name: "device",
      label: T.filters.device,
      allLabel: T.filters.allDevices,
      options: EARLY_DEVICES.map((value) => ({ value, label: DEVICE_LABEL[value] })),
    },
    { kind: "text", name: "source", label: T.filters.source, ltr: true },
  );
  return fields;
}
