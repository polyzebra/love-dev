import { z } from "zod";
import { MESSAGE_MAX_LENGTH } from "@/lib/constants";

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1, "Message cannot be empty").max(MESSAGE_MAX_LENGTH),
  replyToId: z.string().cuid().optional(),
});

export const reactionSchema = z.object({
  messageId: z.string().cuid(),
  emoji: z.string().min(1).max(8),
});

export const conversationActionSchema = z.object({
  action: z.enum(["pin", "unpin", "archive", "unarchive", "mute", "unmute", "read"]),
});

/** Recipient-side message state ack (Phase 0G realtime receipts). */
export const receiptSchema = z.object({
  kind: z.enum(["delivered", "read"]),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
