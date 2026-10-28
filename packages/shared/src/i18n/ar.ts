import { arAdminAi } from "./ar.admin-ai.js";
import { arAdminBilling } from "./ar.admin-billing.js";
import { arAdminBrand } from "./ar.admin-brand.js";
import { arAdminConsole } from "./ar.admin-console.js";
import { arAdminContent } from "./ar.admin-content.js";
import { arAdminDrugs } from "./ar.admin-drugs.js";
import { arAdminEditor } from "./ar.admin-editor.js";
import { arAdminEvals } from "./ar.admin-evals.js";
import { arAdminGateways } from "./ar.admin-gateways.js";
import { arAdminGrowth } from "./ar.admin-growth.js";
import { arAdminRevenue } from "./ar.admin-revenue.js";
import { arAdminSeo } from "./ar.admin-seo.js";
import { arAdminSettings } from "./ar.admin-settings.js";
import { arAdminSiteHealth } from "./ar.admin-site-health.js";
import { arAdminWaAgent } from "./ar.admin-wa-agent.js";
import { arAdmin } from "./ar.admin.js";
import { arBilling } from "./ar.billing.js";
import { arCapture } from "./ar.capture.js";
import { arChat } from "./ar.chat.js";
import { arCore } from "./ar.core.js";
import { arDashboard } from "./ar.dashboard.js";
import { arErrors } from "./ar.errors.js";
import { arGrowthConsole } from "./ar.growth-console.js";
import { arGrowth } from "./ar.growth.js";
import { arMedications } from "./ar.medications.js";
import { arOrg } from "./ar.org.js";
import { arPublicContent } from "./ar.public-content.js";
import { arPublic } from "./ar.public.js";
import { arReferralsWeb } from "./ar.referrals-web.js";
import { arRewards } from "./ar.rewards.js";
import { arRx } from "./ar.rx.js";
import { arWithdrawWeb } from "./ar.withdraw-web.js";
import { arWithdrawals } from "./ar.withdrawals.js";

// Default locale. Keys are the source of truth; `en.ts` is typed against them.
export const ar = {
  ...arCore,
  ...arPublic,
  ...arPublicContent,
  ...arAdmin,
  ...arAdminAi,
  ...arAdminBilling,
  ...arAdminGateways,
  ...arAdminGrowth,
  ...arAdminConsole,
  ...arAdminContent,
  ...arAdminEditor,
  ...arAdminRevenue,
  ...arAdminSettings,
  ...arAdminSeo,
  ...arAdminSiteHealth,
  ...arAdminWaAgent,
  ...arAdminBrand,
  ...arAdminDrugs,
  ...arAdminEvals,
  ...arRx,
  ...arMedications,
  ...arRewards,
  ...arReferralsWeb,
  ...arOrg,
  ...arWithdrawals,
  ...arWithdrawWeb,
  ...arGrowth,
  ...arGrowthConsole,
  ...arCapture,
  ...arChat,
  ...arDashboard,
  ...arBilling,
  ...arErrors,
} as const;

export type MessageKey = keyof typeof ar;
