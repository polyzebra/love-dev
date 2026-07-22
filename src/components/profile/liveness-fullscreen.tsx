"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * L9.4 - focused full-screen capture surface for AWS Face Liveness on mobile.
 *
 * The AWS "Get ready" screen, camera preview, oval and CTA are taller than a
 * phone viewport and were overlapping the bottom navigation and the iPhone
 * status bar inside the profile card. This renders the active capture in a
 * dedicated fixed layer via a portal to <body> so it sits ABOVE the bottom nav
 * (z-40), covers the gallery behind it, and respects the safe-area insets.
 *
 * Behaviour: locks background scroll while open; moves focus into the layer and
 * restores it on close (accessible dialog); dvh height so iOS Safari's dynamic
 * toolbars never clip the CTA. Desktop gets the same layer with a centred,
 * max-width column - acceptable as a focused flow.
 */
export function LivenessFullscreen({
  title,
  step,
  onClose,
  children,
}: {
  title: string;
  /** Concise step label shown under the title (e.g. "Get ready", "Checking your video"). */
  step?: string;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Prevent the background page from scrolling behind the capture surface.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Move focus into the layer; remember the trigger to restore on close.
    prevFocus.current = document.activeElement as HTMLElement | null;
    layerRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow; // restore scroll
      prevFocus.current?.focus?.(); // restore focus to the Verify control
    };
  }, []);

  return createPortal(
    <div
      ref={layerRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      className="bg-background fixed inset-0 z-50 overflow-y-auto outline-none"
      style={{
        // dvh (not vh) so the iOS Safari toolbars never clip the CTA below the fold.
        minHeight: "100dvh",
        paddingTop: "max(env(safe-area-inset-top), 1rem)",
        paddingBottom: "max(env(safe-area-inset-bottom), 1rem)",
        paddingLeft: "max(env(safe-area-inset-left), 1rem)",
        paddingRight: "max(env(safe-area-inset-right), 1rem)",
      }}
    >
      {/* Safe-area-correct Tirvea top bar: identity + concise step + close. This
          is what makes the flow read as a Tirvea verification surface rather than
          a raw embedded provider widget. */}
      <div className="mx-auto flex w-full max-w-md items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-gold text-[0.7rem] font-semibold tracking-[0.25em] uppercase">
            Tirvea verification
          </p>
          {step && <p className="text-foreground mt-0.5 text-sm font-medium">{step}</p>}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close verification"
            className="glass-chip flex size-10 shrink-0 items-center justify-center rounded-full"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="mx-auto flex min-h-[calc(100dvh-8rem)] w-full max-w-md flex-col justify-center py-8">
        {children}
      </div>
    </div>,
    document.body,
  );
}
