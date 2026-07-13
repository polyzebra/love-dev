import { z } from "zod";

/**
 * Shared request contracts for the admin mutation routes (Phase 0E).
 * Routes validate with these; the admin UI submits matching payloads.
 */

export const adminUserStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "SHADOW_BANNED"]),
});

export const reportResolveSchema = z.object({
  outcome: z.enum(["ACTION_TAKEN", "DISMISSED"]),
  resolution: z.string().trim().min(1).max(500).optional(),
});

export const verificationReviewSchema = z.object({
  approve: z.boolean(),
});

export const featureFlagSetSchema = z.object({
  enabled: z.boolean(),
});

/** Path segment for /api/admin/flags/[key] - one namespaced identifier. */
export const featureFlagKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);

export const exploreCategoryToggleSchema = z.object({
  isActive: z.boolean(),
});

export const exploreCategoryMoveSchema = z.object({
  direction: z.enum(["up", "down"]),
});

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb hex color.");

export const exploreCategoryPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(280),
    gradientFrom: hexColor,
    gradientTo: hexColor,
    iconKey: z.string().trim().min(1).max(40),
    imageUrl: z.string().url().max(500).nullable(),
  })
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update.",
  });
