import { AccountNav } from "../../../../components/account/account-nav";
import { ReauthProvider } from "../../../../lib/reauth";

import type { ReactNode } from "react";

/** Account pages share the sub-navigation and the "confirm it is you" dialog that sensitive actions open. */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <ReauthProvider>
      <AccountNav />
      {children}
    </ReauthProvider>
  );
}
