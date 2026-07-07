"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client (anon key only - never service role). */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "anon-key-not-set",
  );
}
