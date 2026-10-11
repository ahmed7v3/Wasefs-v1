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
  | "usage";

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
} as const satisfies Record<string, PermissionInfo>;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

/** Shape every permission string must have; the DB enforces the same rule with a CHECK. */
export const PERMISSION_PATTERN = /^[a-z][a-z0-9]*([.][a-z][a-z0-9]*)+$/;

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
