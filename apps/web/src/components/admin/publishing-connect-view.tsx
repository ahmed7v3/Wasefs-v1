"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { Button, Card, CardTitle } from "@wasfa/ui";
import { BookOpen, ExternalLink, KeyRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { publishingBaseUrl } from "../../lib/publishing-admin";

import { CopyBlock } from "./publishing-copy-block";

type GuideState = { status: "loading" } | { status: "error" } | { status: "ready"; text: string };

const STEPS = ["step1", "step2", "step3", "step4"] as const;
const TROUBLE = ["401", "403", "429", "422"] as const;
const PROMPT_KEYS = [
  "admin.pub.connect.prompt.1",
  "admin.pub.connect.prompt.2",
  "admin.pub.connect.prompt.3",
  "admin.pub.connect.prompt.4",
  "admin.pub.connect.prompt.en1",
  "admin.pub.connect.prompt.en2",
] as const satisfies readonly MessageKey[];

/** The guide is public text/markdown served by the API itself, so it is fetched without credentials. */
function useGuide(url: string): { guide: GuideState; retry: () => void } {
  const [guide, setGuide] = useState<GuideState>({ status: "loading" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setGuide({ status: "loading" });
    fetch(url, { signal: controller.signal, headers: { Accept: "text/markdown, text/plain" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("guide unavailable");
        const text = await response.text();
        if (text.trim() === "") throw new Error("guide empty");
        setGuide({ status: "ready", text });
      })
      .catch(() => {
        if (!controller.signal.aborted) setGuide({ status: "error" });
      });
    return () => {
      controller.abort();
    };
  }, [url, tick]);

  const retry = useCallback(() => {
    setTick((current) => current + 1);
  }, []);
  return { guide, retry };
}

/** `/admin/content/api`: everything needed to connect an AI agent (Claude) to the Publishing API. */
export function PublishingConnectView() {
  const base = publishingBaseUrl();
  const openapiUrl = `${base}/openapi.json`;
  const guideUrl = `${base}/guide`;
  const { guide, retry } = useGuide(guideUrl);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-text">{t("admin.pub.connect.title")}</h1>
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          <Link
            href="/admin/content/api/docs"
            className="inline-flex items-center gap-2 font-semibold text-primary underline"
          >
            <BookOpen aria-hidden className="size-5" />
            {t("admin.nav.content.apiDocs")}
          </Link>
          <Link
            href="/admin/content/api-keys"
            className="inline-flex items-center gap-2 font-semibold text-primary underline"
          >
            <KeyRound aria-hidden className="size-5" />
            {t("admin.pub.connect.keysLink")}
          </Link>
        </nav>
      </div>
      <p className="text-base text-text-muted">{t("admin.pub.connect.intro")}</p>

      <Card elevation="flat" padding="compact" className="flex flex-col gap-4">
        <CardTitle>{t("admin.pub.connect.endpoint.title")}</CardTitle>
        <CopyBlock
          label={t("admin.pub.connect.endpoint.base")}
          text={base}
          copyLabel={t("admin.pub.connect.endpoint.copy")}
        />
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          <li>
            <a
              href={openapiUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-primary underline"
            >
              {t("admin.pub.connect.endpoint.openapi")}
              <ExternalLink aria-hidden className="size-4" />
            </a>
          </li>
          <li>
            <a
              href={guideUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-primary underline"
            >
              {t("admin.pub.connect.endpoint.guide")}
              <ExternalLink aria-hidden className="size-4" />
            </a>
          </li>
        </ul>
        <CopyBlock
          multiline
          label={t("admin.pub.secret.messageLabel")}
          text={t("admin.pub.claudeMessage.template", { base })}
        />
      </Card>

      <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
        <CardTitle>{t("admin.pub.connect.steps.title")}</CardTitle>
        <ol className="flex flex-col gap-4">
          {STEPS.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span
                aria-hidden
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-on-primary"
              >
                {index + 1}
              </span>
              <div className="flex flex-col gap-1">
                <p className="text-base font-semibold text-text">
                  {t(`admin.pub.connect.${step}.title`)}
                </p>
                <p className="text-sm text-text-muted">{t(`admin.pub.connect.${step}.body`)}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
        <CardTitle>{t("admin.pub.connect.guide.title")}</CardTitle>
        <p className="text-sm text-text-muted">{t("admin.pub.connect.guide.hint")}</p>
        {guide.status === "loading" ? (
          <p role="status" className="text-base text-text-muted">
            {t("admin.pub.connect.guide.loading")}
          </p>
        ) : null}
        {guide.status === "ready" ? (
          <CopyBlock
            multiline
            label={t("admin.pub.connect.guide.title")}
            text={guide.text}
            copyLabel={t("admin.pub.connect.guide.copy")}
          />
        ) : null}
        {guide.status === "error" ? (
          <div role="alert" className="flex flex-col gap-3">
            <p className="text-base text-danger">{t("admin.pub.connect.guide.error")}</p>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="secondary" name="retry-guide" onClick={retry}>
                {t("admin.pub.connect.guide.retry")}
              </Button>
              <a
                href={guideUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-1 font-semibold text-primary underline"
              >
                {t("admin.pub.connect.guide.open")}
                <ExternalLink aria-hidden className="size-4" />
              </a>
            </div>
          </div>
        ) : null}
      </Card>

      <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
        <CardTitle>{t("admin.pub.connect.prompts.title")}</CardTitle>
        {PROMPT_KEYS.map((key) => (
          <CopyBlock
            key={key}
            multiline
            label={t("admin.pub.connect.prompt.copy")}
            copyLabel={t("admin.pub.connect.prompt.copy")}
            text={t(key)}
          />
        ))}
      </Card>

      <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
        <CardTitle>{t("admin.pub.connect.trouble.title")}</CardTitle>
        <ul className="list-disc ps-5 text-sm text-text">
          {TROUBLE.map((code) => (
            <li key={code}>{t(`admin.pub.connect.trouble.${code}`)}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
