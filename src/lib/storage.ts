import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Infrastructure adapter (Phase 0K): THE storage client for object
 * reads/writes (private photo bucket). Domain services must not import
 * the cookie-bound Supabase request helper - route-level authorization
 * is the access boundary (Phase 0I), so storage I/O uses the SERVICE
 * ROLE when configured and only falls back to the request-bound client
 * in keyless dev environments. The framework/request dependency lives in
 * this one allowlisted module (see tests/architecture.test.ts).
 */

let serviceClient: SupabaseClient | null = null;

function serviceStorageClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  serviceClient ??= createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return serviceClient;
}

/** Storage-capable client: service role, or the request-bound dev fallback. */
export async function storageClient(): Promise<SupabaseClient> {
  return serviceStorageClient() ?? (await supabaseServer());
}

/** Service-role-only variant for capabilities that require it (signed URLs). */
export function storageServiceClientOrNull(): SupabaseClient | null {
  return serviceStorageClient();
}
