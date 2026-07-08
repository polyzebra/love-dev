import { z } from "zod";
import { FIRST_MESSAGE_MAX_LENGTH } from "@/lib/constants";

export const sendFirstMessageSchema = z.object({
  toId: z.string().cuid(),
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
