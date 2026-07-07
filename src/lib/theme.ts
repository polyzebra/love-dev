export type AppearanceMode = "SYSTEM" | "LIGHT" | "DARK";

export const THEME_STORAGE_KEY = "virelsy:appearance";

/**
 * Pre-paint theme bootstrap, inlined into <head> as a plain string so
 * the correct theme classes exist before first paint - no flash, no
 * reload. Mirrors resolveTheme(); keep the two in sync.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var m=localStorage.getItem("${THEME_STORAGE_KEY}");if(m!=="LIGHT"&&m!=="DARK"&&m!=="SYSTEM")m="SYSTEM";var light=m==="LIGHT"||(m==="SYSTEM"&&window.matchMedia("(prefers-color-scheme: light)").matches);var c=document.documentElement.classList;c.toggle("light",light);c.toggle("dark",!light);}catch(e){}})();`;

export function resolveIsLight(mode: AppearanceMode): boolean {
  if (mode === "LIGHT") return true;
  if (mode === "DARK") return false;
  return typeof window !== "undefined"
    ? window.matchMedia("(prefers-color-scheme: light)").matches
    : false;
}

/** Apply a mode to <html> with the 250ms cross-fade, and remember it. */
export function applyAppearance(mode: AppearanceMode, opts?: { transition?: boolean }) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const light = resolveIsLight(mode);
  if (opts?.transition !== false) {
    root.classList.add("theming");
    window.setTimeout(() => root.classList.remove("theming"), 320);
  }
  root.classList.toggle("light", light);
  root.classList.toggle("dark", !light);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* storage unavailable (private mode) - class still applied */
  }
}

export function storedAppearance(): AppearanceMode | null {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return v === "LIGHT" || v === "DARK" || v === "SYSTEM" ? v : null;
  } catch {
    return null;
  }
}
