import { z } from "zod";

export const reportSchema = z.object({
  reportedId: z.union([z.string().cuid(), z.string().uuid()], { error: "Invalid user id" }),
  messageId: z.union([z.string().cuid(), z.string().uuid()], { error: "Invalid user id" }).optional(),
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
  blockedId: z.union([z.string().cuid(), z.string().uuid()], { error: "Invalid user id" }),
});

export type ReportInput = z.infer<typeof reportSchema>;
