import { z } from "zod";
import { FIRST_MESSAGE_MAX_LENGTH } from "@/lib/constants";

/**
 * User ids exist in TWO formats: Prisma `cuid()` defaults (seed data)
 * and Supabase Auth UUIDs mirrored verbatim at signup
 * (src/app/auth/callback/route.ts creates users with `id: u.id`).
 * A bare `.cuid()` check rejects every real signed-up user, so accept
 * exactly those two shapes - nothing looser.
 */
const userIdSchema = z.union([z.string().cuid(), z.string().uuid()], {
  error: "Invalid user id",
});

export const sendFirstMessageSchema = z.object({
  toId: userIdSchema,
  body: z
    .string()
    .trim()
    .min(1, "Say something - your message cannot be empty")
    .max(FIRST_MESSAGE_MAX_LENGTH, `Keep it under ${FIRST_MESSAGE_MAX_LENGTH} characters`),
});

export const respondFirstMessageSchema = z.object({
  action: z.enum(["accept", "decline"]),
});

export type SendFirstMessageInput = z.infer<typeof sendFirstMessageSchema>;
export type RespondFirstMessageInput = z.infer<typeof respondFirstMessageSchema>;
