"use client";

/**
 * In-app message chime. Honest about autoplay policy: browsers only
 * allow programmatic audio after a user gesture, so we track the first
 * pointerdown of the session and stay silent until it happened.
 */

const SOUND_URL = "/sounds/message.wav";
const VOLUME = 0.35;
const DEBOUNCE_MS = 1500;

let audio: HTMLAudioElement | null = null;
let userHasInteracted = false;
let interactionHookInstalled = false;
let lastPlayedAt = 0;

/** Preload the element and start watching for the unlocking gesture. */
function ensureSetup(): void {
  if (typeof window === "undefined") return;
  if (!interactionHookInstalled) {
    interactionHookInstalled = true;
    window.addEventListener(
      "pointerdown",
      () => {
        userHasInteracted = true;
      },
      { once: true, passive: true },
    );
  }
  if (!audio && typeof Audio !== "undefined") {
    audio = new Audio(SOUND_URL);
    audio.preload = "auto";
    audio.volume = VOLUME;
  }
}

/** Call once on mount so the chime is decoded before it is needed. */
export function preloadMessageSound(): void {
  ensureSetup();
}

/**
 * Play the chime. No-ops when the pref is off, before the first user
 * gesture, or within the 1.5s debounce window (a burst of messages is
 * one sound, not a slot machine).
 */
export function playMessageSound(enabled: boolean): void {
  if (!enabled) return;
  ensureSetup();
  if (!audio || !userHasInteracted) return;
  const now = Date.now();
  if (now - lastPlayedAt < DEBOUNCE_MS) return;
  lastPlayedAt = now;
  audio.currentTime = 0;
  void audio.play().catch(() => {
    // Autoplay rejected despite our gesture tracking - stay silent.
  });
}

/** Short, subtle vibration for key moments. False when unsupported. */
export function vibrate(enabled: boolean, pattern: number | number[] = 30): boolean {
  if (!enabled) return false;
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return false;
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}
