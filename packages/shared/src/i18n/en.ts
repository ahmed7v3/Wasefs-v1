import { enAdminAi } from "./en.admin-ai.js";
import { enAdminBilling } from "./en.admin-billing.js";
import { enAdminConsole } from "./en.admin-console.js";
import { enAdminContent } from "./en.admin-content.js";
import { enAdminDrugs } from "./en.admin-drugs.js";
import { enAdminEditor } from "./en.admin-editor.js";
import { enAdminEvals } from "./en.admin-evals.js";
import { enAdminGateways } from "./en.admin-gateways.js";
import { enAdminGrowth } from "./en.admin-growth.js";
import { enAdminRevenue } from "./en.admin-revenue.js";
import { enAdminSeo } from "./en.admin-seo.js";
import { enAdminSiteHealth } from "./en.admin-site-health.js";
import { enAdmin } from "./en.admin.js";
import { enBilling } from "./en.billing.js";
import { enCapture } from "./en.capture.js";
import { enChat } from "./en.chat.js";
import { enCore } from "./en.core.js";
import { enDashboard } from "./en.dashboard.js";
import { enErrors } from "./en.errors.js";
import { enGrowthConsole } from "./en.growth-console.js";
import { enGrowth } from "./en.growth.js";
import { enOrg } from "./en.org.js";
import { enPublicContent } from "./en.public-content.js";
import { enPublic } from "./en.public.js";
import { enReferralsWeb } from "./en.referrals-web.js";
import { enRewards } from "./en.rewards.js";
import { enRx } from "./en.rx.js";
import { enWithdrawWeb } from "./en.withdraw-web.js";
import { enWithdrawals } from "./en.withdrawals.js";

import type { MessageKey } from "./ar.js";

// English is planned later: stub with the keys we already have. Missing keys fall back to Arabic.
export const en: Partial<Record<MessageKey, string>> = {
  ...enCore,
  ...enPublic,
  ...enPublicContent,
  ...enAdmin,
  ...enAdminSeo,
  ...enAdminSiteHealth,
  ...enAdminAi,
  ...enAdminBilling,
  ...enAdminGateways,
  ...enAdminGrowth,
  ...enAdminConsole,
  ...enAdminContent,
  ...enAdminEditor,
  ...enAdminRevenue,
  ...enAdminDrugs,
  ...enAdminEvals,
  ...enRx,
  ...enRewards,
  ...enReferralsWeb,
  ...enOrg,
  ...enWithdrawals,
  ...enWithdrawWeb,
  ...enGrowth,
  ...enGrowthConsole,
  ...enCapture,
  ...enChat,
  ...enDashboard,
  ...enBilling,
  ...enErrors,
};
