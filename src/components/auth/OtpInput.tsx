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

/**
 * WebKit engine (the lib uses the same probe for its isIOS check). Only
 * there does the OS draw native selection UI - the blue grab handles and
 * vertical selection line on iPhone - for a selection range in a focused
 * text field.
 */
const isWebKit =
  typeof window !== "undefined" &&
  typeof CSS !== "undefined" &&
  CSS.supports("-webkit-touch-callout", "none");

/**
 * Refocus the boxes after an error handler cleared them. The handlers run
 * in a batched async continuation, so a synchronous `.focus()` hits the
 * still-disabled (verifying) DOM input and is a no-op in browsers that
 * blur on disable. Wait a frame for the enabled+cleared input to commit,
 * then focus and explicitly collapse the selection - a leftover nonzero
 * range is what summons iOS's selection handles.
 */
export function refocusOtpInput(ref: React.RefObject<HTMLInputElement | null>) {
  requestAnimationFrame(() => {
    const el = ref.current;
    if (!el || el.disabled) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });
}

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

  // Our own handle on the real input, alongside the caller's ref.
  const innerRef = React.useRef<HTMLInputElement | null>(null);
  const composedRef = React.useCallback(
    (node: HTMLInputElement | null) => {
      innerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // iOS-handle suppression. input-otp tracks the active box THROUGH the
  // input's selection range and, whenever the value is FULL and focused,
  // deliberately selects the last character (selectionchange handler:
  // caret at maxLength -> setSelectionRange(max-1, max); onFocus ->
  // (max-1, max)). On iPhone Safari that nonzero range makes the OS draw
  // its blue selection handles + vertical line beside the boxes
  // (upstream issue #75, closed unfixed). This capture listener runs
  // BEFORE the lib's document-level one (window is earlier on the
  // capture path) and, only while OUR input is focused and full,
  // (a) keeps a collapsed caret collapsed by stopping the lib's
  // expansion, and (b) collapses the lib's one-char selection to the
  // end. Wider, user-made selections (long-press Select All) pass
  // through untouched, as does every selectionchange while the code is
  // still being typed - the lib's slot tracking stays intact.
  React.useEffect(() => {
    if (!isWebKit) return;
    const guard = (event: Event) => {
      const el = innerRef.current;
      if (!el || document.activeElement !== el) return;
      if (el.value.length < el.maxLength) return;
      const { selectionStart: start, selectionEnd: end } = el;
      if (start === null || end === null) return;
      if (start === end) {
        event.stopPropagation();
      } else if (end - start === 1) {
        event.stopPropagation();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    };
    window.addEventListener("selectionchange", guard, { capture: true });
    return () => window.removeEventListener("selectionchange", guard, { capture: true });
  }, []);

  return (
    <motion.div
      animate={invalid && !reduceMotion ? { x: [0, -4, 4, -4, 4, -4, 4, 0] } : { x: 0 }}
      transition={{ duration: 0.3 }}
    >
      <OTPInput
        ref={composedRef}
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
        containerClassName="flex items-center justify-center gap-2 has-disabled:opacity-60"
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
        // Fluid width capped at 3.5rem so the row spans the card (the old
        // justify-between spread) without stretch utilities.
        "border-input bg-foreground/5 relative flex h-14 w-full max-w-14 items-center justify-center rounded-2xl border text-xl font-medium tabular-nums shadow-[inset_0_1px_0_var(--glass-highlight)] transition-all",
        isActive && "border-foreground/30 ring-foreground/20 z-10 ring-2",
        invalid && "border-destructive ring-0",
      )}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="animate-caret-blink bg-foreground h-6 w-px duration-1000" />
        </div>
      )}
    </div>
  );
}
