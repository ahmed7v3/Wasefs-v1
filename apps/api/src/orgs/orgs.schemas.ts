import {
  acceptInviteTokenSchema,
  createInviteSchema,
  orgInviteParamsSchema,
  orgMemberParamsSchema,
  updateMemberRoleSchema,
  updateOrgSchema,
} from "@wasfa/shared/schemas/org";
import { idParamSchema } from "@wasfa/shared/schemas/user";

import { createZodDto, parseWithSchema } from "../common/validation.js";

import type { PipeTransform } from "@nestjs/common";
import type { z } from "zod";

export class OrgIdParamDto extends createZodDto(idParamSchema) {}
export class OrgMemberParamsDto extends createZodDto(orgMemberParamsSchema) {}
export class OrgInviteParamsDto extends createZodDto(orgInviteParamsSchema) {}
export class UpdateOrgDto extends createZodDto(updateOrgSchema) {}
export class UpdateMemberRoleDto extends createZodDto(updateMemberRoleSchema) {}
export class AcceptInviteTokenDto extends createZodDto(acceptInviteTokenSchema) {}

export type CreateInviteBody = z.output<typeof createInviteSchema>;

/**
 * `createInviteSchema` is a union (email or phone), which a DTO class cannot extend, and a union
 * parameter type erases the class Nest's global pipe looks at. This pipe parses it explicitly.
 */
export const createInviteBodyPipe: PipeTransform = {
  transform: (value: unknown): CreateInviteBody => parseWithSchema(createInviteSchema, value),
};
