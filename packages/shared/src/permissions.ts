/*
 * Permission catalog.
 *
 * Permission strings are NOT a database table: this typed const is the only list of what can be
 * granted, so a typo in `@RequirePermission("user.read")` fails to compile. Which role holds which
 * permission is data (`roles` + `role_permissions`) and is edited from the admin panel; code only
 * ships the defaults used to seed system roles (`packages/db/src/seed-data.ts`).
 *
 * Add a permission here in the phase that introduces the feature behind it, never earlier: an unused
 * permission is dead weight in every role editor. A string stored in the DB that is no longer in
 * this catalog is ignored by the resolver (it can only ever deny).
 */

export type PermissionGroup =
  | "users"
  | "orgs"
  | "roles"
  | "settings"
  | "flags"
  | "audit"
  | "issues"
  | "ai"
  | "plans"
  | "credits"
  | "drugs"
  | "evals"
  | "usage"
  | "billing"
  | "payments"
  | "promotions"
  | "coupons"
  | "withdrawals"
  | "finance"
  | "alerts"
  | "referrals"
  | "rewards"
  | "deals"
  | "content"
  | "wa_agent";

export interface Label {
  ar: string;
  en: string;
}

export interface PermissionInfo {
  group: PermissionGroup;
  label: Label;
}

export const PERMISSION_GROUPS: Record<PermissionGroup, Label> = {
  users: { ar: "المستخدمون", en: "Users" },
  orgs: { ar: "المؤسسات", en: "Organizations" },
  roles: { ar: "الأدوار والصلاحيات", en: "Roles and permissions" },
  settings: { ar: "إعدادات الموقع", en: "Site settings" },
  flags: { ar: "مفاتيح الميزات", en: "Feature flags" },
  audit: { ar: "سجل التدقيق", en: "Audit log" },
  issues: { ar: "الأخطاء والمشاكل", en: "Issues" },
  ai: { ar: "الذكاء الاصطناعي", en: "AI" },
  plans: { ar: "الباقات", en: "Plans" },
  credits: { ar: "الرصيد", en: "Credits" },
  drugs: { ar: "قاعدة الأدوية", en: "Drug database" },
  evals: { ar: "تقييم الدقة", en: "Accuracy evaluation" },
  usage: { ar: "الاستهلاك والتكلفة", en: "Usage and cost" },
  billing: { ar: "الفوترة والأسعار", en: "Billing and prices" },
  payments: { ar: "المدفوعات", en: "Payments" },
  promotions: { ar: "العروض الترويجية", en: "Promotions" },
  coupons: { ar: "الكوبونات", en: "Coupons" },
  withdrawals: { ar: "سحب النقاط", en: "Points withdrawals" },
  finance: { ar: "البيانات المالية", en: "Financial data" },
  alerts: { ar: "تنبيهات الإدارة", en: "Admin alerts" },
  referrals: { ar: "الإحالات", en: "Referrals" },
  rewards: { ar: "المكافآت والنقاط", en: "Rewards and points" },
  deals: { ar: "الاتفاقات الخاصة", en: "Deals" },
  content: { ar: "المحتوى", en: "Content" },
  wa_agent: { ar: "وكيل واتساب", en: "WhatsApp agent" },
};

export const PERMISSIONS = {
  "users.read": {
    group: "users",
    label: { ar: "عرض المستخدمين وتفاصيلهم", en: "View users and their details" },
  },
  "users.suspend": {
    group: "users",
    label: { ar: "إيقاف المستخدمين وإعادة تفعيلهم", en: "Suspend and reactivate users" },
  },
  "users.roles.write": {
    group: "users",
    label: { ar: "منح أدوار المستخدمين وسحبها", en: "Grant and revoke user roles" },
  },
  "orgs.read": {
    group: "orgs",
    label: { ar: "عرض المؤسسات وأعضائها", en: "View organizations and their members" },
  },
  "orgs.write": {
    group: "orgs",
    label: { ar: "تعديل بيانات المؤسسات", en: "Edit organizations" },
  },
  "roles.read": {
    group: "roles",
    label: { ar: "عرض الأدوار وصلاحياتها", en: "View roles and their permissions" },
  },
  "roles.write": {
    group: "roles",
    label: { ar: "إنشاء الأدوار وتعديل صلاحياتها", en: "Create roles and edit their permissions" },
  },
  "settings.read": {
    group: "settings",
    label: { ar: "عرض إعدادات الموقع", en: "View site settings" },
  },
  "settings.write": {
    group: "settings",
    label: { ar: "تعديل إعدادات الموقع", en: "Edit site settings" },
  },
  "flags.read": {
    group: "flags",
    label: { ar: "عرض مفاتيح الميزات", en: "View feature flags" },
  },
  "flags.write": {
    group: "flags",
    label: { ar: "إنشاء مفاتيح الميزات وتعديلها", en: "Create and edit feature flags" },
  },
  "audit.read": {
    group: "audit",
    label: { ar: "عرض سجل التدقيق", en: "View the audit log" },
  },
  "issues.read": {
    group: "issues",
    label: { ar: "عرض الأخطاء المسجلة", en: "View recorded errors" },
  },
  "issues.write": {
    group: "issues",
    label: { ar: "تغيير حالة الأخطاء", en: "Change the status of errors" },
  },
  "ai.read": {
    group: "ai",
    label: {
      ar: "عرض مزودي الذكاء الاصطناعي والنماذج والمسارات",
      en: "View AI providers, models and routes",
    },
  },
  "ai.write": {
    group: "ai",
    label: { ar: "تعديل المزودين والنماذج والمسارات", en: "Edit AI providers, models and routes" },
  },
  "ai.killswitch": {
    group: "ai",
    label: { ar: "إيقاف الذكاء الاصطناعي فورًا", en: "Switch AI off immediately" },
  },
  "plans.read": {
    group: "plans",
    label: { ar: "عرض الباقات وتعييناتها", en: "View plans and their assignments" },
  },
  "plans.write": {
    group: "plans",
    label: { ar: "إنشاء الباقات وتعديلها وتعيينها", en: "Create, edit and assign plans" },
  },
  "credits.adjust": {
    group: "credits",
    label: { ar: "تعديل أرصدة المستخدمين يدويًا", en: "Adjust user credit balances manually" },
  },
  "drugs.read": {
    group: "drugs",
    label: { ar: "عرض قاعدة الأدوية", en: "View the drug database" },
  },
  "drugs.write": {
    group: "drugs",
    label: { ar: "استيراد الأدوية وتعديلها", en: "Import and edit drugs" },
  },
  "evals.run": {
    group: "evals",
    label: { ar: "تشغيل تقييمات الدقة وعرضها", en: "Run and view accuracy evaluations" },
  },
  "usage.read": {
    group: "usage",
    label: { ar: "عرض الاستهلاك والتكلفة", en: "View usage and cost" },
  },
  "users.upgrade": {
    group: "users",
    label: {
      ar: "ترقية باقة مستخدم أو تمديدها يدويًا",
      en: "Upgrade or extend a user's plan manually",
    },
  },
  "users.read_health": {
    group: "users",
    label: {
      ar: "عرض روشتات المستخدمين (بيانات صحية، مع تسجيل السبب)",
      en: "View users' prescriptions (health data, reason logged)",
    },
  },
  "users.read_chats": {
    group: "users",
    label: {
      ar: "عرض محادثات المستخدمين (بيانات صحية، مع تسجيل السبب)",
      en: "View users' chats (health data, reason logged)",
    },
  },
  "billing.read": {
    group: "billing",
    label: {
      ar: "عرض الطلبات والاشتراكات والمدفوعات والأسعار",
      en: "View orders, subscriptions, payments and prices",
    },
  },
  "billing.write": {
    group: "billing",
    label: {
      ar: "تعديل الأسعار وطرق الدفع والضرائب وبوابات الدفع",
      en: "Edit prices, payment methods, tax and gateways",
    },
  },
  "payments.review": {
    group: "payments",
    label: { ar: "مراجعة المدفوعات اليدوية واعتمادها", en: "Review and approve manual payments" },
  },
  "payments.refund": {
    group: "payments",
    label: { ar: "استرداد المدفوعات", en: "Refund payments" },
  },
  "promotions.write": {
    group: "promotions",
    label: { ar: "إنشاء العروض الترويجية وتعديلها", en: "Create and edit promotions" },
  },
  "coupons.write": {
    group: "coupons",
    label: { ar: "إنشاء كوبونات الخصم وتعديلها", en: "Create and edit coupons" },
  },
  "withdrawals.review": {
    group: "withdrawals",
    label: { ar: "مراجعة طلبات سحب النقاط", en: "Review points withdrawal requests" },
  },
  "withdrawals.pay": {
    group: "withdrawals",
    label: { ar: "تسجيل صرف طلبات السحب", en: "Mark withdrawal requests as paid" },
  },
  "finance.export": {
    group: "finance",
    label: { ar: "تصدير البيانات المالية", en: "Export financial data" },
  },
  "alerts.receive": {
    group: "alerts",
    label: { ar: "استلام تنبيهات الإدارة", en: "Receive admin alerts" },
  },
  "referrals.read": {
    group: "referrals",
    label: { ar: "عرض الإحالات والمكافآت والنقاط", en: "View referrals, rewards and points" },
  },
  "referrals.write": {
    group: "referrals",
    label: {
      ar: "إدارة برامج الإحالة وقواعد المكافآت وأكواد الشركاء",
      en: "Manage referral programs, reward rules and partner codes",
    },
  },
  "rewards.adjust": {
    group: "rewards",
    label: { ar: "تعديل أرصدة النقاط يدويًا", en: "Adjust points balances manually" },
  },
  "deals.write": {
    group: "deals",
    label: { ar: "إنشاء الاتفاقات الخاصة وروابط الانضمام", en: "Create deals and join links" },
  },
  "content.read": {
    group: "content",
    label: { ar: "عرض المحتوى والمسودات ومعاينتها", en: "View content, drafts and previews" },
  },
  "content.write": {
    group: "content",
    label: {
      ar: "كتابة المقالات وتعديل المسودات ورفع الوسائط",
      en: "Write articles, edit drafts and upload media",
    },
  },
  "content.publish": {
    group: "content",
    label: { ar: "جدولة المحتوى ونشره وإلغاء نشره", en: "Schedule, publish and unpublish content" },
  },
  "content.review": {
    group: "content",
    label: {
      ar: "المراجعة الطبية: اعتماد المحتوى أو طلب تعديلات",
      en: "Medical review: approve content or request changes",
    },
  },
  "content.manage": {
    group: "content",
    label: {
      ar: "إدارة التصنيفات والوسوم والكتّاب والتحويلات وأرشفة المحتوى",
      en: "Manage categories, tags, people, redirects and archive content",
    },
  },
  "wa_agent.read": {
    group: "wa_agent",
    label: {
      ar: "عرض إعدادات وكيل واتساب واستهلاكه",
      en: "View the WhatsApp agent settings and usage",
    },
  },
  "wa_agent.write": {
    group: "wa_agent",
    label: {
      ar: "تعديل وكيل واتساب وإيقاف المحادثات وحظرها وضبط مفتاح الصوت",
      en: "Edit the WhatsApp agent, pause or block chats and set the voice key",
    },
  },
  "wa_agent.inbox": {
    group: "wa_agent",
    label: {
      ar: "قراءة محادثات واتساب ومرفقاتها (بيانات صحية، تُسجَّل القراءة)",
      en: "Read WhatsApp transcripts and media (health data, reads are logged)",
    },
  },
} as const satisfies Record<string, PermissionInfo>;

export type Permission = keyof typeof PERMISSIONS;

/** Additional permission required to receive each alert kind, beyond alerts.receive. */
export const ALERT_KIND_PERMISSION = {
  "payment.review_needed": "payments.review",
  "payment.review_overdue": "payments.review",
  "payment.amount_mismatch": "payments.review",
  "payment.failure_spike": "payments.review",
  "refund.requested": "payments.review",
  "payment_method.account_change_requested": "billing.write",
  "payment_method.account_change_canceled": "billing.write",
  "payment_method.account_change_applied": "billing.write",
  "withdrawal.requested": "withdrawals.review",
  "withdrawal.overdue": "withdrawals.review",
  "credits.reconcile_drift": "billing.read",
  "points.reconcile_drift": "billing.read",
  "reward.fraud_flag": "alerts.receive",
  "system.test": "alerts.receive",
} as const satisfies Record<import("./billing.js").AlertKind, Permission>;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

/** Shape every permission string must have; the DB enforces the same rule with a CHECK. */
export const PERMISSION_PATTERN = /^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$/;

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && Object.hasOwn(PERMISSIONS, value);
}

/**
 * System roles seeded by the database package. They cannot be deleted. `user` is implicit: every
 * account has it without a `user_roles` row, and it carries no admin permissions.
 * `super_admin` is a wildcard in the resolver (Task 1.6), so permissions added later reach it
 * without a data migration.
 */
export const SYSTEM_ROLE_KEYS = [
  "user",
  "support",
  "marketing",
  "finance",
  "admin",
  "super_admin",
] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

/** Shape every role key must have; the DB enforces the same rule with a CHECK. */
export const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;
