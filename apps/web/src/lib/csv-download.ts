import { toRequestError } from "./api-client";
import { publicEnv } from "./env";

/**
 * Fetches a CSV from the API with the admin's cookie and saves it as a file. The text goes through a
 * Blob link, so nothing is written to the page and no third party sees it. Resolves with the CSV text
 * (the caller can count rows); throws the usual `ApiRequestError` on a refusal.
 */
export async function downloadCsv(path: string, filename: string): Promise<string> {
  const response = await fetch(`${publicEnv.NEXT_PUBLIC_API_URL}${path}`, {
    credentials: "include",
    headers: { Accept: "text/csv" },
  });
  if (!response.ok) throw await toRequestError(response);
  const text = await response.text();
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke after the click has been handled by the browser.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
  return text;
}
