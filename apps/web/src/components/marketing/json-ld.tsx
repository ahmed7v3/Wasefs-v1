import { serializeJsonLd, type JsonLd as JsonLdData } from "../../lib/structured-data";

/**
 * One `<script type="application/ld+json">`. The CSP has no `'unsafe-inline'` for scripts, so it
 * carries the request's nonce (`getNonce()`); the content is JSON with `<` escaped, never raw HTML.
 */
export function JsonLd({ data, nonce }: { data: JsonLdData; nonce: string | undefined }) {
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
