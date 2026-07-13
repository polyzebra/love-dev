import { AuthCard } from "@/components/auth/AuthCard";
import { AuthStepFallback } from "@/components/auth/AuthStepFallback";

/**
 * Segment loading state for (auth) route entries - the router's proper
 * mechanism for a still-streaming child slot (without it the slot can
 * commit as null, which is exactly the empty-card frame captured on a
 * real iPhone). It owns a COMPLETE card: fallback and content are each
 * self-contained, so no state can show card chrome without content.
 */
export default function AuthLoading() {
  return (
    <AuthCard>
      <AuthStepFallback label="Opening sign in..." />
    </AuthCard>
  );
}
