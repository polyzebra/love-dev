import { db } from "@/lib/db";
import { validateStripeEnvStatic } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * GET /api/health -> { status, database, config, billing, timestamp }
 *
 * Liveness + configuration probe. `config.missing` lists the NAMES of
 * production-critical env vars that are absent (never their values) -
 * exactly the diagnosis needed when the deployed site 500s but local
 * works. Everything listed here fails closed elsewhere, so naming a
 * missing var gives an attacker nothing actionable.
 */
const REQUIRED_IN_PRODUCTION = [
  "DATABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "AUTH_HASH_SALT",
  "NEXT_PUBLIC_SITE_URL",
  "CRON_SECRET",
] as const;

export async function GET() {
  let database = "ok";
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (error) {
    database = "unreachable";
    console.error("[health] database check failed:", error);
  }

  const missing =
    process.env.NODE_ENV === "production"
      ? REQUIRED_IN_PRODUCTION.filter((name) => !process.env[name]?.trim())
      : [];

  // Billing degrades independently: a broken Stripe config is NAMED here
  // (variable names and problem descriptions only, never values) without
  // taking the rest of the app down - payments simply answer 503.
  const stripe = validateStripeEnvStatic();
  const billing = !stripe.configured
    ? "unconfigured"
    : stripe.problems.length === 0
      ? "ok"
      : { problems: stripe.problems };
  const billingDegraded =
    process.env.NODE_ENV === "production" && stripe.configured && stripe.problems.length > 0;

  return Response.json({
    status:
      database === "ok" && missing.length === 0 && !billingDegraded ? "healthy" : "degraded",
    database,
    config: missing.length === 0 ? "ok" : { missing },
    billing,
    timestamp: new Date().toISOString(),
  });
}
