import { t } from "@wasfa/shared/i18n";

import { displayUrl } from "../../lib/ads-admin";

/**
 * What a WhatsApp ad looks like in the chat (docs/ADS.md, ads/whatsapp-ads): the «إعلان» label is
 * added by code on the first line, then the creative's text, then the link. Preview only: the
 * runtime builds the real message.
 */
export function WhatsAppAdPreview({ text, url }: { text: string; url: string }) {
  const label = t("ads.label");
  return (
    <figure className="flex flex-col gap-2" data-testid="wa-preview">
      <figcaption className="text-sm font-semibold text-text">
        {t("admin.ads.wa.preview")}
      </figcaption>
      <div className="rounded-xl bg-neutral-100 p-3">
        <div className="max-w-xs whitespace-pre-line rounded-lg rounded-ss-sm bg-success-soft px-3 py-2 text-base text-text shadow-sm">
          <p className="font-semibold" data-testid="wa-preview-label">
            {label}
          </p>
          <p className="mt-1 break-words">
            {text.trim() === "" ? t("admin.ads.wa.previewEmpty") : text}
          </p>
          {url.trim() === "" ? null : (
            <p className="mt-1 break-all text-primary underline">
              <bdi dir="ltr">{displayUrl(url.trim())}</bdi>
            </p>
          )}
        </div>
      </div>
    </figure>
  );
}
