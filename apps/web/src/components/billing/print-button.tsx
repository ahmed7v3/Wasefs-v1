"use client";

import { t } from "@wasfa/shared/i18n";
import { Button } from "@wasfa/ui";
import { Printer } from "lucide-react";

/** Opens the browser's print dialog; the receipt's own `print:` styles hide everything else. */
export function PrintButton() {
  return (
    <Button
      variant="secondary"
      onClick={() => {
        window.print();
      }}
    >
      <Printer aria-hidden className="size-4" />
      {t("billing.receipt.print")}
    </Button>
  );
}
