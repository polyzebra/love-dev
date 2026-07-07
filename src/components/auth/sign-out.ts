"use client";

import { supabaseBrowser } from "@/lib/supabase/client";

/** Ends the Supabase session and hard-navigates so all state resets. */
export async function signOutEverywhere(redirectTo = "/") {
  await supabaseBrowser().auth.signOut();
  window.location.assign(redirectTo);
}
