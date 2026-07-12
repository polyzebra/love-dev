"use client";

import { useCallback, useRef } from "react";

/**
 * Focus-return for CONTROLLED dialogs (open driven by state, no Radix
 * DialogTrigger): Radix has no trigger to restore focus to, so Escape/close
 * would drop focus on <body>. Call `capture()` in the handler that opens the
 * dialog and pass `restoreFocus` to DialogContent's onCloseAutoFocus.
 * Same convention as the phase-D fix in SafetyMenu/ChatActions.
 */
export function useDialogOpener() {
  const openerRef = useRef<HTMLElement | null>(null);
  const capture = useCallback(() => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);
  const restoreFocus = useCallback((e: Event) => {
    e.preventDefault();
    openerRef.current?.focus();
  }, []);
  return { capture, restoreFocus };
}
