import { idParamSchema, updateMeSchema } from "@wasfa/shared/schemas/user";

import { createZodDto } from "../common/validation.js";

export class UpdateMeDto extends createZodDto(updateMeSchema) {}

export class IdParamDto extends createZodDto(idParamSchema) {}
