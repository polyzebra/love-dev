"use client";

import * as React from "react";
import { OTPInput, REGEXP_ONLY_DIGITS, type SlotProps } from "input-otp";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Six-box one-time-code field on the single-hidden-input pattern
 * (input-otp): ONE real <input> stretched invisibly across the boxes,
 * which are purely visual. That is the robust choice for iOS Safari -
 * the keychain "From Messages/Mail" code suggestion, full-code paste,
 * auto-advance and backspace all work because the browser only ever
 * sees one ordinary text field; six separate inputs break at least one
 * of those on every iOS version.
 *
 * Accessibility follows the same shape: the real input carries the
 * aria-label and the whole value, each box is announced through it -
 * per-box labels on decorative divs would only mislead screen readers.
 *
 * Neutral interaction language: boxes keep a 1px neutral border; the
 * active box gets ring-2 ring-foreground/20 (a control's keyboard
 * focus), never rose. Destructive tint appears only via `invalid`.
 */

/** Default box count; steps pass channel-specific lengths (email may be 6-10 per Supabase config). */
export const OTP_LENGTH = 6;

export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  invalid = false,
  autoFocus = false,
  label = "Verification code",
  describedById,
  length = OTP_LENGTH,
  ref,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Fires once the final digit lands - the steps auto-submit here. */
  onComplete: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  label?: string;
  /** id of the error banner/text while invalid. */
  describedById?: string;
  /** Digit count - mirrors the provider's configured code length. */
  length?: number;
  /** Reaches the real input - `.focus()` after clearing an error. */
  ref?: React.Ref<HTMLInputElement>;
}) {
  // A brief +-4px shake when the code comes back wrong - transform
  // only, three cycles, and skipped entirely under reduced motion
  // (the destructive borders already carry the message).
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      animate={
        invalid && !reduceMotion ? { x: [0, -4, 4, -4, 4, -4, 4, 0] } : { x: 0 }
      }
      transition={{ duration: 0.3 }}
    >
      <OTPInput
        ref={ref}
        value={value}
        onChange={onChange}
        onComplete={onComplete}
        maxLength={length}
        pattern={REGEXP_ONLY_DIGITS}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedById : undefined}
        containerClassName="flex items-center justify-between gap-2 has-disabled:opacity-60"
        render={({ slots }) => (
          <>
            {slots.map((slot, i) => (
              <OtpBox key={i} invalid={invalid} {...slot} />
            ))}
          </>
        )}
      />
    </motion.div>
  );
}

function OtpBox({ char, hasFakeCaret, isActive, invalid }: SlotProps & { invalid: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative flex h-14 w-11 items-center justify-center rounded-2xl border border-input bg-foreground/5 text-xl font-medium tabular-nums shadow-[inset_0_1px_0_var(--glass-highlight)] transition-all",
        isActive && "z-10 border-foreground/30 ring-2 ring-foreground/20",
        invalid && "border-destructive ring-0",
      )}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-px animate-caret-blink bg-foreground duration-1000" />
        </div>
      )}
    </div>
  );
}
