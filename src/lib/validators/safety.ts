import { z } from "zod";

export const reportSchema = z.object({
  reportedId: z.string().cuid(),
  messageId: z.string().cuid().optional(),
  reason: z.enum([
    "FAKE_PROFILE",
    "INAPPROPRIATE_CONTENT",
    "HARASSMENT",
    "SPAM",
    "SCAM",
    "UNDERAGE",
    "OFFLINE_BEHAVIOUR",
    "OTHER",
  ]),
  details: z.string().trim().max(1000).optional(),
});

export const blockSchema = z.object({
  blockedId: z.string().cuid(),
});

export type ReportInput = z.infer<typeof reportSchema>;
