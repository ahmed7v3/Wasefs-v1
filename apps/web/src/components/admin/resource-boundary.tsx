"use client";

import { t } from "@wasfa/shared/i18n";
import { Skeleton } from "@wasfa/ui";

import { ErrorNotice } from "../error-notice";

import type { ResourceHandle } from "../../lib/use-admin-data";
import type { ReactNode } from "react";

/** Loading skeleton, error with retry, or the data: the three states every fetched block has. */
export function ResourceBoundary<T>({
  resource,
  children,
}: {
  resource: ResourceHandle<T>;
  children: (data: T) => ReactNode;
}) {
  if (resource.status === "loading") {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <p className="sr-only" role="status">
          {t("ui.loading")}
        </p>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-5/6" />
      </div>
    );
  }
  if (resource.status === "error") {
    return <ErrorNotice error={resource.error} onRetry={resource.reload} />;
  }
  return <>{children(resource.data)}</>;
}
