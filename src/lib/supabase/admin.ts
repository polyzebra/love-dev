// Build-time guard: Next.js fails the build if any client-component graph
// ever imports this module. Do NOT remove - the service-role key bypasses
// RLS and must never be reachable from the browser bundle. (Because of this
// guard the module is also unimportable under plain node/tsx test runs -
// production code therefore imports it LAZILY and only after
// serviceRoleKeyPresent() from phone-flow.ts says the key exists; tests
// inject their own structural clients instead.)
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase ADMIN client (service role). Used exclusively for
 * identity maintenance the anon/session clients cannot do - today that is
 * writing auth.users.phone (+ phone_confirmed_at via phone_confirm) after
 * a Twilio-approved verification, and the phone reconciliation service.
 *
 * Env validation is lazy and names the missing variable, so importing the
 * module never throws at build time; callers that reach this WITHOUT the
 * key configured should have branched into the durable FAILED/PENDING
 * path first (see syncVerifiedPhoneToAuth) instead of calling this.
 */

let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("supabaseAdmin: NEXT_PUBLIC_SUPABASE_URL is not set");
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "supabaseAdmin: SUPABASE_SERVICE_ROLE_KEY is not set (server-only secret - never NEXT_PUBLIC_)",
    );
  }
  cached = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
