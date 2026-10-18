"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { getWorkspaceOrgId, setWorkspaceOrgId } from "../../lib/workspace";

export interface WorkspaceSyncProps {
  /** Ids of the organizations the person is an active member of. */
  orgIds: readonly string[];
}

/**
 * Drops a remembered workspace the person can no longer use (they left, or were removed), silently:
 * the next request would only answer 404. Renders nothing.
 */
export function WorkspaceSync({ orgIds }: WorkspaceSyncProps) {
  const router = useRouter();
  const key = orgIds.join(",");
  useEffect(() => {
    const chosen = getWorkspaceOrgId();
    if (chosen !== null && !key.split(",").includes(chosen)) {
      setWorkspaceOrgId(null);
      router.refresh();
    }
  }, [key, router]);
  return null;
}
