import { z } from "zod";

import { PHONE_VERIFICATION_MODES } from "../auth-settings.js";
import { LOCALES } from "../i18n/index.js";
import { ACCOUNT_TYPES, ORG_MEMBER_ROLES, ORG_TYPES, USER_STATUSES } from "../identity.js";
import {
  PERMISSION_KEYS,
  ROLE_KEY_PATTERN,
  SYSTEM_ROLE_KEYS,
  isPermission,
  type Permission,
} from "../permissions.js";
import { SETTING_VISIBILITIES, flagKeySchema } from "../settings.js";

import { phoneNumberSchema } from "./auth.js";
import { WA_PAIRING_ERRORS, WA_PAIRING_STATES, waPairingCodeSchema } from "./phone.js";
import { meResponseSchema } from "./user.js";

/*
 * Admin v1 contract (Task 1.10): requests are parsed by the api under `/admin/*`, responses by the
 * admin pages. Lists are cursor-paginated (keyset on `(created_at desc, id desc)`, hard cap 100).
 */

const isoDate = z.iso.datetime({ offset: true });

/**
 * A date FILTER sent by the client: an ISO datetime whose year Postgres accepts. Year 0 parses as
 * ISO but makes the query fail (found by the E2E suite).
 */
const isoDateFilter = isoDate.refine((value) => {
  const year = Number(value.slice(0, 4));
  return year >= 1970 && year <= 9999;
}, "out of range");

export const ADMIN_PAGE_DEFAULT = 25;
export const ADMIN_PAGE_MAX = 100;

/**
 * `cursor` is opaque to clients (base64url of `<created_at>|<id>`); the api rejects a malformed one
 * with `VALIDATION_FAILED`. Responses are `{ items, nextCursor }`, `nextCursor` null on the last page.
 */
export const cursorQuerySchema = z.object({
  cursor: z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(ADMIN_PAGE_MAX).default(ADMIN_PAGE_DEFAULT),
});
export type CursorQuery = z.output<typeof cursorQuerySchema>;

const searchTextSchema = z.string().trim().min(1).max(100);

// ---------------------------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------------------------

export const adminUserListQuerySchema = cursorQuerySchema.extend({
  /** Name or email (contains) or, when it looks like a phone number (`+` and digits), a phone prefix. */
  q: searchTextSchema.optional(),
  status: z.enum(USER_STATUSES).optional(),
  role: z.string().regex(ROLE_KEY_PATTERN).optional(),
});

export const adminUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** `null` for phone-only accounts (their placeholder address is never shown). */
  email: z.string().nullable(),
  phone: z.string().nullable(),
  emailVerified: z.boolean(),
  phoneVerified: z.boolean(),
  status: z.enum(USER_STATUSES),
  roles: z.array(z.string()),
  accountType: z.enum(ACCOUNT_TYPES),
  createdAt: isoDate,
  lastLoginAt: isoDate.nullable(),
});
export type AdminUserListQuery = z.output<typeof adminUserListQuerySchema>;
export type AdminUser = z.output<typeof adminUserSchema>;

export const adminUserListResponseSchema = z.object({
  items: z.array(adminUserSchema),
  nextCursor: z.string().nullable(),
});

// Audit entries come before the user detail, which embeds the latest ones.
export const auditEntrySchema = z.object({
  id: z.uuid(),
  actorId: z.uuid().nullable(),
  /** Joined from `users`; null for the system (CLI, workers) and for unknown actors. */
  actorName: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: isoDate,
});
export type AuditEntry = z.output<typeof auditEntrySchema>;

export const adminUserDetailSchema = z.object({
  user: adminUserSchema.extend({
    suspendedReason: z.string().nullable(),
    twoFactorEnabled: z.boolean(),
    deletedAt: isoDate.nullable(),
    locale: z.enum(LOCALES),
  }),
  profile: meResponseSchema.shape.profile,
  organizations: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      type: z.enum(ORG_TYPES),
      role: z.enum(ORG_MEMBER_ROLES),
    }),
  ),
  sessions: z.array(
    z.object({
      id: z.uuid(),
      createdAt: isoDate,
      lastSeenAt: isoDate,
      expiresAt: isoDate,
      ipAddress: z.string().nullable(),
      userAgent: z.string().nullable(),
    }),
  ),
  /** The last 20 audit rows where the user is the target or the actor. */
  recentAudit: z.array(auditEntrySchema),
});
export type AdminUserDetail = z.output<typeof adminUserDetailSchema>;

/** A written reason for suspensions and role changes (kept in the audit trail). */
export const reasonSchema = z.object({ reason: z.string().trim().min(5).max(500) });

export const userRoleParamsSchema = z.object({
  id: z.uuid(),
  roleKey: z.string().regex(ROLE_KEY_PATTERN),
});

/** Answer of the role grant and revoke routes; `changed` is false for an idempotent no-op. */
export const adminUserRolesResponseSchema = z.object({
  roles: z.array(z.string()),
  changed: z.boolean(),
});

export const adminSuspendResponseSchema = z.object({
  status: z.enum(USER_STATUSES),
});

// ---------------------------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------------------------

export const adminOrgListQuerySchema = cursorQuerySchema.extend({
  q: searchTextSchema.optional(),
});

export const adminOrgSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(ORG_TYPES),
  country: z.string(),
  city: z.string().nullable(),
  memberCount: z.number().int().nonnegative(),
  createdAt: isoDate,
});
export type AdminOrgListQuery = z.output<typeof adminOrgListQuerySchema>;
export type AdminOrg = z.output<typeof adminOrgSchema>;

export const adminOrgListResponseSchema = z.object({
  items: z.array(adminOrgSchema),
  nextCursor: z.string().nullable(),
});

/** The organization's fields plus its members and the number of pending invitations. */
export const adminOrgDetailSchema = adminOrgSchema.extend({
  members: z.array(
    z.object({
      userId: z.uuid(),
      name: z.string(),
      role: z.enum(ORG_MEMBER_ROLES),
      joinedAt: isoDate,
    }),
  ),
  pendingInvites: z.number().int().nonnegative(),
});
export type AdminOrgDetail = z.output<typeof adminOrgDetailSchema>;

// ---------------------------------------------------------------------------------------------
// Roles and permissions
// ---------------------------------------------------------------------------------------------

const permissionSchema = z.custom<Permission>((value) => isPermission(value), "unknown permission");
const permissionListSchema = z
  .array(permissionSchema)
  .max(PERMISSION_KEYS.length)
  .refine((list) => new Set(list).size === list.length, "duplicate permission");
const roleNameSchema = z.string().trim().min(1).max(60);

export const roleSchema = z.object({
  key: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  isSystem: z.boolean(),
  permissions: z.array(permissionSchema),
  /** Users holding the role (the implicit `user` role has no rows, so it shows 0). */
  holders: z.number().int().nonnegative(),
});
export type AdminRole = z.output<typeof roleSchema>;

export const roleListResponseSchema = z.object({ items: z.array(roleSchema) });

export const roleParamSchema = z.object({ key: z.string().regex(ROLE_KEY_PATTERN) });

export const createRoleSchema = z.object({
  key: z
    .string()
    .regex(ROLE_KEY_PATTERN)
    .refine((key) => !(SYSTEM_ROLE_KEYS as readonly string[]).includes(key), "reserved key"),
  nameAr: roleNameSchema,
  nameEn: roleNameSchema,
  permissions: permissionListSchema,
});

export const updateRoleSchema = z
  .object({
    nameAr: roleNameSchema.optional(),
    nameEn: roleNameSchema.optional(),
    permissions: permissionListSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "nothing to update",
  });

const labelSchema = z.object({ ar: z.string(), en: z.string() });

/** `GET /admin/permissions`: the catalog grouped for the role editor. */
export const permissionCatalogSchema = z.object({
  groups: z.array(
    z.object({
      key: z.string(),
      label: labelSchema,
      permissions: z.array(z.object({ key: permissionSchema, label: labelSchema })),
    }),
  ),
});
export type PermissionCatalog = z.output<typeof permissionCatalogSchema>;

// ---------------------------------------------------------------------------------------------
// Settings and flags
// ---------------------------------------------------------------------------------------------

export const adminSettingSchema = z.object({
  key: z.string(),
  visibility: z.enum(SETTING_VISIBILITIES),
  /** The effective value: the stored one, or the code default while no row exists. */
  value: z.unknown(),
  updatedAt: isoDate.nullable(),
  updatedBy: z.uuid().nullable(),
});
export type AdminSetting = z.output<typeof adminSettingSchema>;

export const adminSettingsResponseSchema = z.object({ items: z.array(adminSettingSchema) });

/** The registry schema of the key validates `value`; this only requires the wrapper. */
export const putSettingSchema = z.object({ value: z.unknown() });

export const flagKeyParamSchema = z.object({ key: flagKeySchema });

export const adminFlagSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
  rules: z.unknown(),
  updatedAt: isoDate,
});
export type AdminFlag = z.output<typeof adminFlagSchema>;

export const adminFlagListResponseSchema = z.object({ items: z.array(adminFlagSchema) });

// ---------------------------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------------------------

export const auditQuerySchema = cursorQuerySchema.extend({
  actorId: z.uuid().optional(),
  action: z
    .string()
    .regex(/^[a-z_.]{1,64}$/)
    .optional(),
  targetType: z
    .string()
    .regex(/^[a-z_.]{1,64}$/)
    .optional(),
  targetId: z.string().min(1).max(100).optional(),
  from: isoDateFilter.optional(),
  to: isoDateFilter.optional(),
});

export type AuditQuery = z.output<typeof auditQuerySchema>;

export const auditListResponseSchema = z.object({
  items: z.array(auditEntrySchema),
  nextCursor: z.string().nullable(),
});

// ---------------------------------------------------------------------------------------------
// Issues (error_events grouped by fingerprint)
// ---------------------------------------------------------------------------------------------

export const ISSUE_STATUSES = ["new", "investigating", "resolved"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

// Fastify refuses path parameters longer than 100 characters before our code runs.
export const ISSUE_FINGERPRINT_PATTERN = /^[a-f0-9]{8,100}$/;
export const issueParamSchema = z.object({
  fingerprint: z.string().regex(ISSUE_FINGERPRINT_PATTERN),
});

export const issueListQuerySchema = cursorQuerySchema.extend({
  status: z.enum(ISSUE_STATUSES).optional(),
});

export type IssueListQuery = z.output<typeof issueListQuerySchema>;

export const issueSchema = z.object({
  fingerprint: z.string(),
  code: z.string(),
  route: z.string().nullable(),
  method: z.string().nullable(),
  message: z.string().nullable(),
  count: z.number().int().nonnegative(),
  affectedUsers: z.number().int().nonnegative(),
  firstSeen: isoDate,
  lastSeen: isoDate,
  /** The latest event's status: a new event after "resolved" shows the regression as "new". */
  status: z.enum(ISSUE_STATUSES),
  /** The `WSF-XXXX-XXXX` reference of the latest event. */
  sampleRef: z.string(),
});
export type Issue = z.output<typeof issueSchema>;

export const issueListResponseSchema = z.object({
  items: z.array(issueSchema),
  nextCursor: z.string().nullable(),
});

export const issueDetailSchema = issueSchema.extend({
  /** The latest 20 events of the group. */
  events: z.array(
    z.object({
      ref: z.string(),
      createdAt: isoDate,
      userId: z.uuid().nullable(),
      requestId: z.string().nullable(),
      context: z.unknown(),
      stack: z.string().nullable(),
    }),
  ),
});
export type IssueDetail = z.output<typeof issueDetailSchema>;

export const updateIssueSchema = z.object({ status: z.enum(ISSUE_STATUSES) });

// ---------------------------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------------------------

export const adminStatsSchema = z.object({
  /** Accounts that are not deleted. */
  users: z.object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    suspended: z.number().int().nonnegative(),
    newLast7Days: z.number().int().nonnegative(),
  }),
  orgs: z.object({ total: z.number().int().nonnegative() }),
  /** Issue groups whose latest event is not resolved. */
  issues: z.object({ open: z.number().int().nonnegative() }),
});
export type AdminStats = z.output<typeof adminStatsSchema>;

// ---------------------------------------------------------------------------------------------
// WhatsApp verification number (/admin/whatsapp)
// ---------------------------------------------------------------------------------------------

/** `POST /admin/whatsapp/link`: the number to pair, as E.164. */
export const linkWhatsappSchema = z.object({ number: phoneNumberSchema });

/** `PUT /admin/whatsapp/verification`: the phone-verification kill switch. */
export const setPhoneVerificationSchema = z.object({ enabled: z.boolean() });

/**
 * `PUT /admin/whatsapp/customer-messages`: customer notifications from the linked number. The
 * same shape as the `whatsapp.customerMessages` setting it writes.
 */
export const customerMessagesSettingsSchema = z
  .object({
    enabled: z.boolean(),
    dailyCap: z.number().int().min(1).max(2_000),
    perUserDailyCap: z.number().int().min(1).max(10),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
  })
  .refine((value) => value.endHour > value.startHour, {
    message: "endHour must be after startHour",
    path: ["endHour"],
  });
export type CustomerMessagesSettingsInput = z.output<typeof customerMessagesSettingsSchema>;

export const adminWhatsappPairingSchema = z.object({
  id: z.string(),
  cmd: z.enum(["link", "unlink"]),
  state: z.enum(WA_PAIRING_STATES),
  /** Only with `state: "code"`: a short-lived secret for the admin who asked for it. */
  code: waPairingCodeSchema.optional(),
  /** Masked to the last four digits. */
  number: z.string().optional(),
  expiresAt: isoDate.optional(),
  reason: z.enum(WA_PAIRING_ERRORS).optional(),
});
export type AdminWhatsappPairing = z.output<typeof adminWhatsappPairingSchema>;

export const adminWhatsappStatusSchema = z.object({
  /** The number users send their code to: the saved setting, else `WHATSAPP_NUMBER`. E.164. */
  number: phoneNumberSchema.nullable(),
  numberSource: z.enum(["setting", "env"]).nullable(),
  bridge: z.object({
    status: z.enum(["connecting", "connected", "disconnected", "logged_out", "down"]),
    /** When the bridge last reported; null if it never did (or the heartbeat expired). */
    lastBeatAt: isoDate.nullable(),
  }),
  /** The bridge's answer to the last link/unlink command, while it is still relevant. */
  pairing: adminWhatsappPairingSchema.nullable(),
  phoneVerification: z.enum(PHONE_VERIFICATION_MODES),
  available: z.boolean(),
  unavailableReason: z.enum(["disabled", "not_configured", "bridge_down"]).optional(),
  /** Customer notifications over WhatsApp: the settings and today's count (UTC day). */
  customerMessages: z.object({
    enabled: z.boolean(),
    dailyCap: z.number().int(),
    perUserDailyCap: z.number().int(),
    timezone: z.string(),
    startHour: z.number().int(),
    endHour: z.number().int(),
    sentToday: z.number().int().min(0),
  }),
});
export type AdminWhatsappStatus = z.output<typeof adminWhatsappStatusSchema>;

/** `POST /admin/whatsapp/link|unlink`: the command was queued; poll the status for the outcome. */
export const adminWhatsappCommandResponseSchema = z.object({ id: z.string() });
