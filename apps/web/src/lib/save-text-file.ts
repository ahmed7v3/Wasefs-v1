/**
 * Saves text the page already holds (a CSV built from loaded rows) as a file, through a Blob link:
 * nothing is sent anywhere. Revokes the object URL after the click has been handled.
 */
export function saveTextFile(
  filename: string,
  text: string,
  mime = "text/csv;charset=utf-8",
): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}
