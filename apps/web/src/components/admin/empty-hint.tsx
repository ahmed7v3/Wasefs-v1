import { EmptyState } from "@wasfa/ui";

import type { ReactNode } from "react";

/** An empty list that explains what to do next (ADMIN-CONSOLE-SPEC §9), never a bare "no data". */
export function EmptyHint({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return <EmptyState icon={icon} title={title} description={hint} action={action} />;
}
