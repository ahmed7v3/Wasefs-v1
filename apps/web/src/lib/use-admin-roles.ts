"use client";

import { roleListResponseSchema, type AdminRole } from "@wasfa/shared/schemas/admin";
import { useMemo } from "react";

import { useResource } from "./use-admin-data";

export interface AdminRoles {
  /** `null` while loading, when the account may not read roles, or when the request failed. */
  roles: readonly AdminRole[] | null;
  /** Role key → Arabic name, for chips and filters (empty until the list is known). */
  names: ReadonlyMap<string, string>;
}

/**
 * The role list for the pickers of the users screens. `enabled` follows `roles.read`: without it the
 * screens fall back to plain role keys and the API stays the authority on what can be granted.
 */
export function useAdminRoles(enabled: boolean): AdminRoles {
  const resource = useResource(enabled ? "/admin/roles" : null, roleListResponseSchema);
  const roles = resource.status === "ready" ? resource.data.items : null;
  const names = useMemo(
    () => new Map((roles ?? []).map((role) => [role.key, role.nameAr])),
    [roles],
  );
  return { roles, names };
}
