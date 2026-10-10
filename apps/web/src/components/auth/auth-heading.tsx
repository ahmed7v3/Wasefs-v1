import type { ReactNode } from "react";

/** The one `h1` of an auth screen, with an optional lead sentence under it. */
export function AuthHeading({ title, lead }: { title: ReactNode; lead?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-2">
      <h1 className="font-heading text-3xl font-bold text-primary">{title}</h1>
      {lead ? <p className="text-lg text-text-muted">{lead}</p> : null}
    </header>
  );
}

/** A quiet line under the form, such as "no account yet? create one". */
export function AuthFooter({ children }: { children: ReactNode }) {
  return <p className="mt-6 text-center text-base text-text-muted">{children}</p>;
}
