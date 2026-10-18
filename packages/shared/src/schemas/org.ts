import { z } from "zod";

import { ORDER_KINDS, ORDER_STATUSES } from "../billing.js";
import { COUNTRY_CODE_PATTERN, ORG_MEMBER_ROLES, ORG_TYPES } from "../identity.js";
import { JOIN_LINK_APPROVALS } from "../rewards.js";

import { emailSchema, phoneNumberSchema } from "./auth.js";
import { subscriptionViewSchema } from "./subscriptions.js";

/*
 * Organizations, members and invitations (Task 1.7). Requests are parsed by the api, responses by
 * the web app. Members never see each other's email or phone; invites show a masked target only.
 */

/** Pending (unaccepted, unexpired) invites one organization may have at a time. */
export const MAX_PENDING_INVITES_PER_ORG = 20;
/** Invitations created per inviter per day (each can send an email). */
export const MAX_INVITES_PER_USER_PER_DAY = 30;
export const INVITE_TTL_DAYS = 7;

export const orgNameSchema = z.string().trim().min(2).max(120);
export const countryCodeSchema = z.string().trim().toUpperCase().regex(COUNTRY_CODE_PATTERN);
export const citySchema = z.string().trim().min(1).max(100);

/** Organization details, as entered in the onboarding `organization` step. */
export const orgDetailsSchema = z.object({
  name: orgNameSchema,
  type: z.enum(ORG_TYPES),
  country: countryCodeSchema,
  city: citySchema.optional(),
});

/** `PATCH /orgs/:id` (org_admin): any subset, at least one field. `city: null` clears it. */
export const updateOrgSchema = z
  .object({
    name: orgNameSchema.optional(),
    type: z.enum(ORG_TYPES).optional(),
    country: countryCodeSchema.optional(),
    city: citySchema.nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "nothing to update",
  });

export const orgMemberParamsSchema = z.object({ id: z.uuid(), userId: z.uuid() });
export const orgInviteParamsSchema = z.object({ id: z.uuid(), inviteId: z.uuid() });

/** `PATCH /orgs/:id/members/:userId` (org_admin). */
export const updateMemberRoleSchema = z.object({ role: z.enum(ORG_MEMBER_ROLES) });

/** `POST /orgs/:id/invites` (org_admin): exactly one of email / phone. */
export const createInviteSchema = z.union([
  z.object({
    email: emailSchema,
    role: z.enum(ORG_MEMBER_ROLES).default("org_member"),
  }),
  z.object({
    phone: phoneNumberSchema,
    role: z.enum(ORG_MEMBER_ROLES).default("org_member"),
  }),
]);
export type CreateInviteInput = z.input<typeof createInviteSchema>;

/** `POST /invites/accept`: the token from the email link (`/invite#<token>`). */
export const acceptInviteTokenSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{43}$/),
});

const isoDate = z.iso.datetime({ offset: true });

export const orgResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(ORG_TYPES),
  country: z.string(),
  city: z.string().nullable(),
  myRole: z.enum(ORG_MEMBER_ROLES),
  memberCount: z.number().int().nonnegative(),
  createdAt: isoDate,
});
export type OrgResponse = z.output<typeof orgResponseSchema>;

export const orgListResponseSchema = z.object({ items: z.array(orgResponseSchema) });

/** `POST /orgs/:id/leave`: the last member leaving deletes the organization. */
export const leaveOrgResponseSchema = z.object({ orgDeleted: z.boolean() });

export const orgMemberSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  role: z.enum(ORG_MEMBER_ROLES),
  joinedAt: isoDate,
  isMe: z.boolean(),
});
export const orgMemberListResponseSchema = z.object({ items: z.array(orgMemberSchema) });

export const orgInviteSchema = z.object({
  id: z.uuid(),
  channel: z.enum(["email", "phone"]),
  /** `a•••@example.com` / `+2010•••••67`: enough to recognise, not to harvest. */
  target: z.string(),
  role: z.enum(ORG_MEMBER_ROLES),
  expiresAt: isoDate,
  createdAt: isoDate,
});
export const orgInviteListResponseSchema = z.object({ items: z.array(orgInviteSchema) });

/** An invitation addressed to the caller's verified email or phone (`GET /me/invites`). */
export const myInviteSchema = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  orgName: z.string(),
  orgType: z.enum(ORG_TYPES),
  role: z.enum(ORG_MEMBER_ROLES),
  expiresAt: isoDate,
});
export const myInviteListResponseSchema = z.object({ items: z.array(myInviteSchema) });

/** Masks an invite target for display (keeps the first character and the domain / last two digits). */
export function maskInviteTarget(target: string): string {
  if (target.includes("@")) {
    const [local = "", domain = ""] = target.split("@");
    return `${local.slice(0, 1)}•••@${domain}`;
  }
  return `${target.slice(0, 5)}${"•".repeat(Math.max(target.length - 7, 0))}${target.slice(-2)}`;
}

// --- Organization billing (Phase 3, Task 3.9) -----------------------------------------------------

/** The organization a request acts for (rx, chat, billing). Absent = the caller's personal account. */
export const orgContextIdSchema = z.uuid();

export const orgLinkParamsSchema = z.object({ id: z.uuid(), linkId: z.uuid() });
export const orgOrderParamsSchema = z.object({ id: z.uuid(), orderId: z.uuid() });

/** `PUT /orgs/:id/members/:userId/limit`: `null` removes the cap. */
export const memberLimitSchema = z.object({
  monthlyCreditCap: z.number().int().min(0).max(1_000_000_000).nullable(),
});

/** `GET /join/:slug`: any string; one that matches no link answers the same "not valid" shape. */
export const joinSlugParamSchema = z.object({
  slug: z.string().trim().toLowerCase().max(64),
});

export const joinLinkItemSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  role: z.enum(ORG_MEMBER_ROLES),
  approval: z.enum(JOIN_LINK_APPROVALS),
  dealId: z.uuid().nullable(),
  maxUses: z.number().int().nullable(),
  usedCount: z.number().int().min(0),
  expiresAt: isoDate.nullable(),
  active: z.boolean(),
  createdAt: isoDate,
});
export type JoinLinkItem = z.output<typeof joinLinkItemSchema>;
export const joinLinkListResponseSchema = z.object({ items: z.array(joinLinkItemSchema) });

/** What a visitor sees at `/join/<slug>`; an unknown, disabled, expired or used-up link is `{ valid: false }` only. */
export const joinLandingSchema = z.discriminatedUnion("valid", [
  z.object({
    valid: z.literal(true),
    org: z.object({ name: z.string(), logoUrl: z.string().optional() }),
    benefit: z
      .object({ dealName: z.string().optional(), memberPriceText: z.string().optional() })
      .nullable(),
    approval: z.enum(JOIN_LINK_APPROVALS),
  }),
  z.object({ valid: z.literal(false) }),
]);
export type JoinLanding = z.output<typeof joinLandingSchema>;

export const joinAcceptResponseSchema = z.object({
  outcome: z.enum(["joined", "pending", "already_member"]),
  orgId: z.uuid(),
});
export type JoinAcceptResponse = z.output<typeof joinAcceptResponseSchema>;

const usageMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
/** `GET /orgs/:id/usage.csv?month=YYYY-MM`; the current UTC month when absent. */
export const orgUsageQuerySchema = z.object({ month: usageMonth.optional() });

export const orgDashboardSchema = z.object({
  org: z.object({ id: z.uuid(), name: z.string() }),
  month: usageMonth,
  wallet: z.object({ balance: z.number().int(), allowPersonalFallback: z.boolean() }),
  plan: z.object({ key: z.string(), nameAr: z.string(), nameEn: z.string() }),
  subscription: subscriptionViewSchema.nullable(),
  seats: z.object({
    used: z.number().int().min(0),
    pendingInvites: z.number().int().min(0),
    /** Null = unlimited. */
    limit: z.number().int().min(1).nullable(),
  }),
  members: z.array(
    z.object({
      userId: z.uuid(),
      name: z.string(),
      role: z.enum(ORG_MEMBER_ROLES),
      /** Credits this member's settled calls took from the organization wallet this month. */
      creditsUsed: z.number().int().min(0),
      monthlyCap: z.number().int().min(0).nullable(),
    }),
  ),
  pendingMembers: z.array(z.object({ userId: z.uuid(), name: z.string(), requestedAt: isoDate })),
  joinLinks: z.object({
    total: z.number().int().min(0),
    active: z.number().int().min(0),
    uses: z.number().int().min(0),
  }),
  recentOrders: z.array(
    z.object({
      id: z.uuid(),
      number: z.string(),
      kind: z.enum(ORDER_KINDS),
      totalMinor: z.number().int(),
      currency: z.string(),
      status: z.enum(ORDER_STATUSES),
      createdAt: isoDate,
      paidAt: isoDate.nullable(),
      receiptAvailable: z.boolean(),
    }),
  ),
});
export type OrgDashboard = z.output<typeof orgDashboardSchema>;

/** `POST /institutions/leads`: «اطلب عرضًا خاصًا». */
export const institutionLeadSchema = z.object({
  orgName: orgNameSchema,
  contactName: z.string().trim().min(2).max(100),
  phone: phoneNumberSchema,
  email: emailSchema,
  seats: z.number().int().min(1).max(100_000),
  message: z.string().trim().max(2_000).default(""),
});
export type InstitutionLeadInput = z.output<typeof institutionLeadSchema>;
export const institutionLeadResponseSchema = z.object({ received: z.literal(true) });
