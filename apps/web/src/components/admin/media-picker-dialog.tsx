"use client";

import { t } from "@wasfa/shared/i18n";
import { MEDIA_STATUSES, type MediaAsset } from "@wasfa/shared/schemas/media";
import { Dialog, Field, Input, Select, Tab, TabList, TabPanel, Tabs } from "@wasfa/ui";
import { useState } from "react";

import { useMediaList } from "../../lib/use-media-list";

import { MediaGrid } from "./media-grid";
import { MediaUploadPanel } from "./media-upload-panel";

export interface MediaPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the chosen `ready` asset (from the library or just uploaded); the dialog then closes. */
  onSelect: (asset: MediaAsset) => void;
  /** Dialog title; defaults to «اختيار صورة». */
  title?: string;
}

const PICKER_STATUSES = MEDIA_STATUSES.filter((status) => status !== "staged");

function PickerBody({
  onSelect,
  onOpenChange,
}: Pick<MediaPickerDialogProps, "onSelect" | "onOpenChange">) {
  const [tab, setTab] = useState<"library" | "upload">("library");
  const [status, setStatus] = useState("ready");
  const [search, setSearch] = useState("");
  const list = useMediaList(status);

  const choose = (asset: MediaAsset) => {
    onSelect(asset);
    onOpenChange(false);
  };

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => {
        setTab(next === "upload" ? "upload" : "library");
      }}
    >
      <TabList aria-label={t("admin.media.picker.tabs")}>
        <Tab value="library">{t("admin.media.picker.library")}</Tab>
        <Tab value="upload">{t("admin.media.picker.upload")}</Tab>
      </TabList>
      <TabPanel value="library">
        {tab === "library" ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t("admin.media.filter.status")} className="basis-40">
                {(control) => (
                  <Select
                    {...control}
                    name="status"
                    value={status}
                    onChange={(event) => {
                      setStatus(event.target.value);
                    }}
                  >
                    {PICKER_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {t(`admin.media.status.${value}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t("admin.media.filter.search")} className="min-w-0 flex-1 basis-40">
                {(control) => (
                  <Input
                    {...control}
                    name="search"
                    type="search"
                    autoComplete="off"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                    }}
                  />
                )}
              </Field>
            </div>
            <MediaGrid
              list={list}
              search={search}
              onChoose={(asset) => {
                // Only a finished image can be placed in content.
                if (asset.status === "ready") choose(asset);
              }}
              chooseLabel={(asset) =>
                t("admin.media.picker.choose", {
                  name: asset.altAr ?? asset.originalFilename ?? asset.sha256.slice(0, 8),
                })
              }
            />
          </div>
        ) : null}
      </TabPanel>
      <TabPanel value="upload">
        {tab === "upload" ? <MediaUploadPanel onReady={choose} /> : null}
      </TabPanel>
    </Tabs>
  );
}

/**
 * The media picker of the content editor (also the person form's photo): a library tab (status filter,
 * search over alt text and file names) and an upload tab. An upload that ends `ready` is selected at once.
 * Mounted only while open, so it fetches nothing when closed.
 */
export function MediaPickerDialog({ open, onOpenChange, onSelect, title }: MediaPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title ?? t("admin.media.picker.title")}>
      {open ? <PickerBody onSelect={onSelect} onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}
