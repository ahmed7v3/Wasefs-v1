"use client";

import { t } from "@wasfa/shared/i18n";
import { MEDIA_STATUSES, mediaAssetSchema, type MediaAsset } from "@wasfa/shared/schemas/media";
import { Card } from "@wasfa/ui";
import { useState } from "react";
import { z } from "zod";

import { useResource } from "../../lib/use-admin-data";
import { useMediaList } from "../../lib/use-media-list";
import { useUrlParams } from "../../lib/use-url-params";

import { FilterBar, type FilterField } from "./filter-bar";
import { MediaAssetDrawer } from "./media-asset-drawer";
import { MediaGrid } from "./media-grid";
import { MediaUploadPanel } from "./media-upload-panel";

const idSchema = z.uuid();
const LIBRARY_STATUSES = MEDIA_STATUSES.filter((status) => status !== "staged");

export interface MediaLibraryViewProps {
  permissions: readonly string[];
}

/** `/admin/media`: upload, browse and edit the public image library. */
export function MediaLibraryView({ permissions }: MediaLibraryViewProps) {
  const url = useUrlParams();
  const canWrite = permissions.includes("content.write");
  const status = LIBRARY_STATUSES.find((value) => value === url.get("status")) ?? "ready";
  const search = url.get("q");
  const list = useMediaList(status);
  // A just-saved asset replaces the list's copy; the drawer reads from the list first.
  const [saved, setSaved] = useState<MediaAsset | null>(null);

  const selectedId = idSchema.safeParse(url.get("asset"));
  const inList = selectedId.success
    ? list.items.find((asset) => asset.id === selectedId.data)
    : undefined;
  // A deep link to an asset that is not on the loaded page is fetched on its own.
  const fetched = useResource(
    selectedId.success && !inList ? `/admin/media/${selectedId.data}` : null,
    mediaAssetSchema,
  );
  const current =
    saved && selectedId.success && saved.id === selectedId.data
      ? saved
      : (inList ?? (fetched.status === "ready" ? fetched.data : null));

  const fields: FilterField[] = [
    {
      kind: "select",
      name: "status",
      label: t("admin.media.filter.status"),
      allLabel: t("admin.media.status.ready"),
      options: LIBRARY_STATUSES.filter((value) => value !== "ready").map((value) => ({
        value,
        label: t(`admin.media.status.${value}`),
      })),
    },
    {
      kind: "search",
      name: "q",
      label: t("admin.media.filter.search"),
      placeholder: t("admin.media.filter.searchHint"),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {canWrite ? (
        <Card elevation="flat" padding="compact">
          <MediaUploadPanel onReady={list.refresh} onSettled={list.refresh} />
        </Card>
      ) : null}

      <FilterBar fields={fields} />
      <p className="text-sm text-text-muted">{t("admin.media.searchNote")}</p>

      <MediaGrid
        list={list}
        search={search}
        onChoose={(asset) => {
          setSaved(null);
          url.update({ asset: asset.id });
        }}
        chooseLabel={(asset) =>
          t("admin.media.open", {
            name: asset.altAr ?? asset.originalFilename ?? asset.sha256.slice(0, 8),
          })
        }
      />

      <MediaAssetDrawer
        asset={selectedId.success ? current : null}
        canWrite={canWrite}
        onClose={() => {
          url.update({ asset: null });
        }}
        onSaved={(asset) => {
          setSaved(asset);
          list.replace(asset);
        }}
      />
    </div>
  );
}
