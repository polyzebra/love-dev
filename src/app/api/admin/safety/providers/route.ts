import { ok, requirePermission } from "@/lib/api";
import { listProviderHealth } from "@/lib/services/appeals";
import { externalProvider, pickProvider } from "@/lib/services/moderation";
import { resolveConfiguredProviders } from "@/lib/services/moderation-providers";
import { isEmailConfigured, pickEmailProvider } from "@/lib/services/email";

/**
 * GET /api/admin/safety/providers - staff view of the external provider
 * plane: which moderation providers are configured (ordered fallback
 * chain), the active selection, rolling ProviderHealth rows (consecutive
 * failures + last error), and whether email transport is configured.
 * Names + health only - never keys.
 */
export async function GET() {
  const { response } = await requirePermission("safety:read");
  if (response) return response;

  const chain = resolveConfiguredProviders(externalProvider).map((p) => p.name);
  const health = await listProviderHealth();

  return ok({
    moderation: {
      active: pickProvider().name,
      configuredChain: chain,
    },
    email: {
      configured: isEmailConfigured(),
      provider: pickEmailProvider().name,
    },
    health,
  });
}
