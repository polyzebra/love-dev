import { z } from "zod";

export const swipeSchema = z.object({
  toId: z.string().cuid(),
  action: z.enum(["LIKE", "PASS", "SUPER_LIKE"]),
});

export type SwipeInput = z.infer<typeof swipeSchema>;
