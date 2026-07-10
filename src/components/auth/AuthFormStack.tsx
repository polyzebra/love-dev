"use client";

import { cn } from "@/lib/utils";

/**
 * AuthFormStack - the ONE vertical rhythm for every auth step body.
 *
 * This deliberately REVERSES the earlier "CTA near the thumb" design.
 * The old shells stretched the card to min-h-[62dvh] and steps pushed
 * their CTA to the bottom with mt-auto, which opened a viewport-height-
 * dependent gulf between the input and its button. The card is now
 * content-driven: the field and its CTA read as one compact group, and
 * the card grows only when content (an inline error, a server banner)
 * actually appears. Clearance from Safari's bottom chrome comes from
 * padding on the (auth) layout's page shell (main pb + safe-bottom
 * footer), never from stretching the form.
 *
 * Rhythm tokens - fixed px from the Tailwind scale, IDENTICAL at every
 * viewport width, and never derived from viewport height:
 * - heading -> support:       8px  (space-y-2, owned by the shells)
 * - support -> field label:  32px  (the shells' mb-8 under the title block)
 * - label -> input:           8px  (space-y-2 inside the `field` cluster)
 * - input -> inline error:    8px  (same cluster; the error renders only
 *                                   with a message, so the card grows
 *                                   naturally instead of reserving space)
 * - field/error -> CTA:      28px  (mt-7 - one token for mobile AND
 *                                   desktop: inside the 24-28px mobile
 *                                   budget and under the 32px desktop cap)
 * - CTA -> footnote:         16px  (mt-4)
 * The optional status layer (server banners, "Checking your code...")
 * sits between the field and the CTA and contributes its 16px gap ONLY
 * while it has content ([&:not(:empty)]:mt-4) - an empty, permanently
 * mounted aria-live region costs 0px.
 */

const FIELD_CLUSTER = "space-y-2";
const STATUS_LAYER = "space-y-4 [&:not(:empty)]:mt-4";
const CTA_GAP = "mt-7";
const FOOTNOTE = "text-center text-xs text-muted-foreground";
const FOOTNOTE_GAP = "mt-4";
/** A footnote directly after content (no CTA above it) takes the CTA gap. */
const FOOTNOTE_GAP_NO_CTA = "mt-7";

export function AuthFormStack({
  onSubmit,
  field,
  status,
  statusLive = false,
  cta,
  footnote,
}: {
  /** When given, the stack renders as a <form noValidate>; otherwise a <div>. */
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
  /** Label + input (+ InlineFieldError) cluster - 8px internal rhythm. */
  field: React.ReactNode;
  /**
   * Server banners / live status lines. Pass it (even as always-rendered
   * conditionals) and the layer stays mounted; it only takes up space
   * while something inside actually renders.
   */
  status?: React.ReactNode;
  /** Marks the status layer aria-live="polite" (OTP verify/lock copy). */
  statusLive?: boolean;
  /** Primary action: submit button, resend line, or a link button. */
  cta?: React.ReactNode;
  /** Small print under the CTA ("Standard SMS rates may apply."). */
  footnote?: React.ReactNode;
}) {
  const body = (
    <>
      <div className={FIELD_CLUSTER}>{field}</div>
      {status !== undefined && (
        <div aria-live={statusLive ? "polite" : undefined} className={STATUS_LAYER}>
          {status}
        </div>
      )}
      {cta != null && <div className={CTA_GAP}>{cta}</div>}
      {footnote != null && (
        <div className={cn(FOOTNOTE, cta != null ? FOOTNOTE_GAP : FOOTNOTE_GAP_NO_CTA)}>
          {footnote}
        </div>
      )}
    </>
  );

  return onSubmit ? (
    <form onSubmit={onSubmit} noValidate>
      {body}
    </form>
  ) : (
    <div>{body}</div>
  );
}
