"use client";

import { useEffect } from "react";
import {
  applyAppearance,
  storedAppearance,
  type AppearanceMode,
} from "@/lib/theme";

/**
 * Keeps the live theme honest:
 * - reconciles the signed-in user's saved appearance (database wins
 *   over a stale localStorage from another account/device)
 * - follows OS light/dark changes while the mode is SYSTEM
 * No visual output; the pre-paint <head> script prevents any flash.
 */
export function ThemeSync({ appearance }: { appearance?: AppearanceMode }) {
  useEffect(() => {
    if (appearance && appearance !== storedAppearance()) {
      applyAppearance(appearance, { transition: false });
    }
  }, [appearance]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      if ((storedAppearance() ?? "SYSTEM") === "SYSTEM") applyAppearance("SYSTEM");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return null;
}
