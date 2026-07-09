/**
 * Supabase PKCE/flow-state errors that mean "this one-time code was
 * already consumed or went stale" - e.g. a second hit on the callback
 * with the same code (flow_state_already_used / flow_state_not_found),
 * an expired flow (flow_state_expired) or a PKCE verifier mismatch.
 * These get friendly "link expired" handling, never a scary error.
 */
export function isFlowStateError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = error.message ?? "";
  return (
    code.includes("flow_state") ||
    code === "bad_code_verifier" ||
    /flow[ _]state|code verifier|both auth code and code verifier/i.test(message)
  );
}
