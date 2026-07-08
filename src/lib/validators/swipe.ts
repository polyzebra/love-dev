import { z } from "zod";

export const swipeSchema = z.object({
  toId: z.union([z.string().cuid(), z.string().uuid()], { error: "Invalid user id" }),
  action: z.enum(["LIKE", "PASS", "SUPER_LIKE"]),
});

export type SwipeInput = z.infer<typeof swipeSchema>;
