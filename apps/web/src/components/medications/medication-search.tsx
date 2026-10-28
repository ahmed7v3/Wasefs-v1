"use client";

import { t } from "@wasfa/shared/i18n";
import { medicationSearchResponseSchema } from "@wasfa/shared/schemas/medications";
import { Button, EmptyState, Input, Skeleton } from "@wasfa/ui";
import { Pill, Search, SearchX } from "lucide-react";
import { useEffect, useState } from "react";

import { ApiRequestError, errorReason } from "../../lib/api-error";
import { buildQuery, useCursorList } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";
import { ErrorNotice } from "../error-notice";

import { MedicationCard } from "./medication-card";

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;

/** A query of digits only is a barcode: the API looks it up exactly. */
export function isBarcodeQuery(value: string): boolean {
  return /^\d+$/.test(value);
}

/**
 * `/medications`: one search box (debounced, also submitted on Enter) whose text lives in the URL
 * (`?q=`) so a search can be shared and Back works. Results come as keyset pages with an explicit
 * "show more" button, never infinite scroll.
 */
export function MedicationSearch() {
  const params = useUrlParams();
  const urlQuery = params.get("q");
  const [text, setText] = useState(urlQuery);
  const trimmed = text.trim();
  const q = trimmed.length >= MIN_QUERY_LENGTH ? trimmed : "";

  useEffect(() => {
    const timer = setTimeout(() => {
      if (trimmed !== urlQuery) params.update({ q: trimmed });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
    // Only the typed text restarts the timer: `params` changes identity with every URL change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed]);

  return (
    <div className="flex flex-col gap-5">
      <form
        role="search"
        className="max-w-xl"
        onSubmit={(event) => {
          event.preventDefault();
          params.update({ q: trimmed });
        }}
      >
        <Input
          type="search"
          value={text}
          onChange={(event) => {
            setText(event.currentTarget.value);
          }}
          aria-label={t("medications.search.label")}
          placeholder={t("medications.search.placeholder")}
          startIcon={<Search className="size-5" />}
          autoComplete="off"
          enterKeyHint="search"
          maxLength={MAX_QUERY_LENGTH}
        />
      </form>

      {q === "" ? (
        <EmptyState
          icon={<Pill />}
          title={t("medications.hint.title")}
          description={t("medications.hint.body")}
        />
      ) : (
        <>
          {isBarcodeQuery(q) ? (
            <p className="text-sm text-text-muted">{t("medications.hint.barcode")}</p>
          ) : null}
          <MedicationResults key={q} q={q} />
        </>
      )}
    </div>
  );
}

function MedicationResults({ q }: { q: string }) {
  const list = useCursorList(
    "/medications/search",
    buildQuery({ q }),
    medicationSearchResponseSchema,
  );

  if (list.status === "loading") {
    return (
      <div aria-busy="true" aria-label={t("medications.loading")} className="flex flex-col gap-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (list.status === "error") {
    if (list.error instanceof ApiRequestError) {
      if (errorReason(list.error) === "feature_off") {
        return (
          <EmptyState
            icon={<Pill />}
            title={t("medications.featureOff.title")}
            description={t("medications.featureOff.body")}
          />
        );
      }
      if (list.error.code === "RATE_LIMITED" || list.error.status === 429) {
        return (
          <div role="alert" className="rounded-md border border-warning bg-warning-soft p-4">
            <p className="text-base text-text">{t("medications.rateLimited")}</p>
          </div>
        );
      }
    }
    return <ErrorNotice error={list.error} onRetry={list.reload} />;
  }

  if (list.items.length === 0) {
    return (
      <EmptyState
        icon={<SearchX />}
        title={t("medications.noResults.title")}
        description={t("medications.noResults.body")}
      />
    );
  }

  return (
    <>
      <ul aria-label={t("medications.resultsLabel")} className="flex flex-col gap-3">
        {list.items.map((item) => (
          <li key={item.id}>
            <MedicationCard item={item} />
          </li>
        ))}
      </ul>
      {list.loadMoreError ? (
        <ErrorNotice error={list.loadMoreError} onRetry={list.loadMore} />
      ) : null}
      {list.nextCursor !== null ? (
        <div>
          <Button variant="secondary" loading={list.loadingMore} onClick={list.loadMore}>
            {t("medications.loadMore")}
          </Button>
        </div>
      ) : null}
    </>
  );
}
