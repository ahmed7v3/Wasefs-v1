"use client";

import { t } from "@wasfa/shared/i18n";
import { Badge, Button, Card, EmptyState, Skeleton, cn } from "@wasfa/ui";
import { ImageOff } from "lucide-react";

import { tOr } from "../../lib/admin-format";
import { matchesMediaSearch } from "../../lib/media-search";
import { ErrorNotice } from "../error-notice";

import { MediaThumb } from "./media-thumb";

import type { MediaList } from "../../lib/use-media-list";
import type { MediaAsset } from "@wasfa/shared/schemas/media";

export interface MediaGridProps {
  list: MediaList;
  search: string;
  /** The asset the user chose (a picker closes; the library opens its drawer). */
  onChoose: (asset: MediaAsset) => void;
  /** Label of the choose button of an asset, for screen readers. */
  chooseLabel: (asset: MediaAsset) => string;
}

/** The thumbnails grid shared by the library and the picker: states, search filter, "load more". */
export function MediaGrid({ list, search, onChoose, chooseLabel }: MediaGridProps) {
  if (list.status === "loading") {
    return (
      <div aria-busy="true" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <p className="sr-only" role="status">
          {t("ui.loading")}
        </p>
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="aspect-square w-full" />
        ))}
      </div>
    );
  }
  if (list.status === "error") return <ErrorNotice error={list.error} onRetry={list.refresh} />;

  const shown = list.items.filter((asset) => matchesMediaSearch(asset, search));
  if (shown.length === 0) {
    return (
      <Card elevation="flat">
        <EmptyState
          icon={<ImageOff />}
          title={t(search.trim() ? "admin.media.noMatch" : "admin.media.empty")}
          description={t(search.trim() ? "admin.media.noMatchHint" : "admin.media.emptyHint")}
        />
        {list.hasMore ? (
          <div className="flex justify-center pt-2">
            <Button variant="secondary" onClick={list.loadMore} loading={list.loadingMore}>
              {t("admin.table.loadMore")}
            </Button>
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="sr-only" role="status">
        {t("admin.media.count", { count: shown.length })}
      </p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((asset) => (
          <li key={asset.id}>
            <button
              type="button"
              aria-label={chooseLabel(asset)}
              onClick={() => {
                onChoose(asset);
              }}
              className={cn(
                "flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface text-start transition-colors duration-150 hover:border-primary focus-visible:outline-none focus-visible:shadow-focus",
                asset.status === "rejected" && "border-danger/40",
              )}
            >
              <MediaThumb asset={asset} />
              <span className="flex min-h-11 flex-col gap-1 p-2 text-sm">
                <span className="line-clamp-2 break-words font-semibold text-text">
                  {asset.altAr ?? asset.originalFilename ?? asset.sha256.slice(0, 8)}
                </span>
                <span className="flex flex-wrap gap-1">
                  {asset.status !== "ready" ? (
                    <Badge tone={asset.status === "rejected" ? "danger" : "info"}>
                      {t(`admin.media.status.${asset.status}`)}
                    </Badge>
                  ) : null}
                  {asset.status === "rejected" ? (
                    <span className="text-danger">
                      {tOr(
                        `admin.media.reject.${asset.rejectReason ?? "unknown"}`,
                        t("admin.media.reject.unknown"),
                      )}
                    </span>
                  ) : null}
                  {asset.status === "ready" && (asset.altAr ?? "") === "" ? (
                    <Badge tone="warning">{t("admin.media.noAlt")}</Badge>
                  ) : null}
                  {asset.usageCount > 0 ? (
                    <Badge tone="neutral">
                      {t("admin.media.usedIn", { count: asset.usageCount })}
                    </Badge>
                  ) : null}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {list.hasMore ? (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={list.loadMore} loading={list.loadingMore}>
            {t("admin.table.loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
