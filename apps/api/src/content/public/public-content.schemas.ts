import { contentLocaleSchema } from "@wasfa/shared/schemas/content";
import { z } from "zod";

/* Request shapes of the public read API that the shared contract does not define. */

export const publicGlossaryIndexQuerySchema = z.object({ locale: contentLocaleSchema });

/** Signed preview tokens are < 600 chars (`verifyPreviewToken` refuses longer ones). */
export const publicPreviewParamSchema = z.object({ token: z.string().min(1).max(600) });
