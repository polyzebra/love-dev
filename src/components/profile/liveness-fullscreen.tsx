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
  onClose,
  children,
}: {
  title: string;
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
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close verification"
          className="glass-chip absolute right-4 z-10 flex size-10 items-center justify-center rounded-full"
          style={{ top: "max(env(safe-area-inset-top), 1rem)" }}
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      )}
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center py-12">
        {children}
      </div>
    </div>,
    document.body,
  );
}
