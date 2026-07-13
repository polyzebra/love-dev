"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lazily-created browser Supabase client (anon key only - never service
 * role). The dynamic import keeps @supabase/* (~65 KB gzip) out of every
 * first-load bundle (Phase 0J): all callers sit inside user-action
 * handlers or already-async flows, so the one-time module fetch on first
 * use is imperceptible and cached for the session.
 */

let clientPromise: Promise<SupabaseClient> | null = null;

export function supabaseBrowser(): Promise<SupabaseClient> {
  clientPromise ??= import("@supabase/ssr").then(({ createBrowserClient }) =>
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "anon-key-not-set",
    ),
  );
  return clientPromise;
}
