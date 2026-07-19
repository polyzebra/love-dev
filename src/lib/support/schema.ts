import { z } from "zod";
import type { SupportCategory } from "@/generated/prisma/enums";

/**
 * Client-safe support contract: category list, labels, field bounds, and the
 * submission schema. NO server imports (no db, no email) so both the client
 * Contact form and the server route/service can share one source of truth.
 */

export const SUPPORT_CATEGORIES = [
  "TECHNICAL",
  "ACCOUNT",
  "SUBSCRIPTION",
  "REFUND",
  "IDENTITY_VERIFICATION",
  "PHOTO_VERIFICATION",
  "PRIVACY",
  "SAFETY",
  "APPEAL",
  "BUSINESS",
  "PRESS",
  "OTHER",
] as const satisfies readonly SupportCategory[];

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  TECHNICAL: "Technical problem",
  ACCOUNT: "Account access",
  SUBSCRIPTION: "Subscription or billing",
  REFUND: "Refund request",
  IDENTITY_VERIFICATION: "Identity verification",
  PHOTO_VERIFICATION: "Photo verification",
  PRIVACY: "Privacy or data request",
  SAFETY: "Report or safety concern",
  APPEAL: "Appeal",
  BUSINESS: "Business enquiry",
  PRESS: "Press enquiry",
  OTHER: "Other",
};

// Field bounds - enforced on the client AND the server.
export const SUPPORT_LIMITS = {
  name: { min: 1, max: 100 },
  email: { max: 254 },
  reference: { max: 80 },
  accountEmail: { max: 254 },
  message: { min: 20, max: 5000 },
} as const;

export const supportRequestSchema = z.object({
  name: z.string().trim().min(SUPPORT_LIMITS.name.min).max(SUPPORT_LIMITS.name.max),
  email: z.string().trim().toLowerCase().email().max(SUPPORT_LIMITS.email.max),
  category: z.enum(SUPPORT_CATEGORIES),
  message: z.string().trim().min(SUPPORT_LIMITS.message.min).max(SUPPORT_LIMITS.message.max),
  accountEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(SUPPORT_LIMITS.accountEmail.max)
    .optional()
    .or(z.literal("")),
  reference: z.string().trim().max(SUPPORT_LIMITS.reference.max).optional().or(z.literal("")),
  // Honeypot: accepted by the schema (so a bot is never tipped off by a
  // validation error) and dropped silently in the route when non-empty.
  website: z.string().max(200).optional().or(z.literal("")),
});

export type SupportRequestInput = z.infer<typeof supportRequestSchema>;
