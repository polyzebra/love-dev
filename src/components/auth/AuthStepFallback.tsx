import { Loader2 } from "lucide-react";

/**
 * Suspense fallback for routed auth steps (the OTP/verify pages wrap
 * their useSearchParams consumers in a boundary). A bare <Suspense>
 * rendered NOTHING here, which painted the (auth) layout's persistent
 * glass card completely empty for the whole boundary resolution - the
 * "blank white card" between submitting a phone/email and the code
 * screen. This fallback keeps the card meaningful the entire time:
 * visible spinner, visible label, stable step-sized dimensions (the
 * Tirvea wordmark is already on screen from the layout header).
 */
export function AuthStepFallback({
  label = "Opening verification...",
}: {
  label?: string;
}) {
  return (
    <div
      data-debug="auth-fallback"
      role="status"
      aria-live="polite"
      // 26rem ≈ the real auth steps' content height (login entry ~453px,
      // email step ~388px): the card must NOT visibly jump in size when
      // the fallback is replaced by the destination UI.
      className="flex min-h-[26rem] flex-col items-center justify-center gap-3"
    >
      <Loader2 className="size-6 animate-spin text-primary-soft" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
