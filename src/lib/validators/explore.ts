import { z } from "zod";

export const exploreFiltersSchema = z.object({
  ageMin: z.coerce.number().int().min(18).max(99).optional(),
  ageMax: z.coerce.number().int().min(18).max(99).optional(),
  country: z.enum(["IE", "GB"]).optional(),
  relationshipGoal: z
    .enum(["LONG_TERM", "SHORT_TERM", "OPEN_TO_EITHER", "FRIENDSHIP", "FIGURING_OUT"])
    .optional(),
  verifiedOnly: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(24).optional(),
});
