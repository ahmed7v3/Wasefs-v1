"use client";

import { lazy, Suspense } from "react";

// The error boundary is part of every route's first load, but an error is rare. The view (and the
// whole message catalogue its `t()` calls pull in) is fetched only when one happens.
const ErrorView = lazy(() => import("../components/error-view"));

export default function ErrorPage(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Suspense fallback={null}>
      <ErrorView {...props} />
    </Suspense>
  );
}
