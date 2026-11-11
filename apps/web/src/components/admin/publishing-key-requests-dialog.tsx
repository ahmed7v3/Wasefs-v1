"use client";

import { t } from "@wasfa/shared/i18n";
import {
  publishingKeyRequestListSchema,
  type PublishingKey,
} from "@wasfa/shared/schemas/admin-publishing-keys";
import { Dialog } from "@wasfa/ui";

import { useResource } from "../../lib/use-admin-data";

import { ResourceBoundary } from "./resource-boundary";

export interface KeyRequestsDialogProps {
  /** The key whose recent requests are shown; `null` = closed (nothing is fetched). */
  target: PublishingKey | null;
  onClose: () => void;
}

const REQUESTS_LIMIT = 50;

function RequestsTable({ id }: { id: string }) {
  const resource = useResource(
    `/admin/content/api-keys/${id}/requests?limit=${REQUESTS_LIMIT}`,
    publishingKeyRequestListSchema,
  );
  return (
    <ResourceBoundary resource={resource}>
      {(data) =>
        data.items.length === 0 ? (
          <p className="text-base text-text-muted">{t("admin.pub.requests.empty")}</p>
        ) : (
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-start text-sm">
              <caption className="sr-only">{t("admin.pub.requests.table")}</caption>
              <thead>
                <tr className="text-text-muted">
                  <th scope="col" className="py-2 pe-3 text-start">
                    {t("admin.pub.requests.time")}
                  </th>
                  <th scope="col" className="py-2 pe-3 text-start">
                    {t("admin.pub.requests.method")}
                  </th>
                  <th scope="col" className="py-2 pe-3 text-start">
                    {t("admin.pub.requests.route")}
                  </th>
                  <th scope="col" className="py-2 pe-3 text-start">
                    {t("admin.pub.requests.status")}
                  </th>
                  <th scope="col" className="py-2 pe-3 text-start">
                    {t("admin.pub.requests.latency")}
                  </th>
                  <th scope="col" className="py-2 text-start">
                    {t("admin.pub.requests.error")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((request, index) => (
                  <tr key={`${request.at}-${index}`} className="border-t border-border">
                    <td className="py-2 pe-3">
                      <bdi dir="ltr">{new Date(request.at).toLocaleString("en-GB")}</bdi>
                    </td>
                    <td className="py-2 pe-3 font-mono" dir="ltr">
                      {request.method}
                    </td>
                    <td className="py-2 pe-3 font-mono" dir="ltr">
                      {request.route}
                    </td>
                    <td className="py-2 pe-3 font-mono" dir="ltr">
                      {request.status}
                    </td>
                    <td className="py-2 pe-3">
                      {t("admin.pub.requests.ms", { ms: request.latencyMs })}
                    </td>
                    <td className="py-2 font-mono" dir="ltr">
                      {request.errorCode ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </ResourceBoundary>
  );
}

/** Recent requests of one key (method, route, status, latency, error code). */
export function KeyRequestsDialog({ target, onClose }: KeyRequestsDialogProps) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("admin.pub.requests.title", { name: target?.name ?? "" })}
    >
      {target ? <RequestsTable id={target.id} /> : null}
    </Dialog>
  );
}
