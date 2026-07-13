import { AuthStepFallback } from "@/components/auth/AuthStepFallback";

/**
 * Segment-level loading state for every (auth) route entry.
 *
 * The (auth) layout is static and streams instantly - wordmark, footer
 * and the glass card paint before the DYNAMIC page inside (e.g. /login
 * awaits the server session lookup before rendering). Without this
 * boundary the card sat completely EMPTY for that gap - the blank white
 * auth card seen when tapping "Sign in" on a cold load. This fallback
 * renders INSIDE the existing card with a visible spinner + label and
 * stable dimensions, and it also makes client-side navigations commit
 * instantly to a branded state instead of holding the previous page.
 */
export default function AuthLoading() {
  return <AuthStepFallback label="Opening sign in..." />;
}
