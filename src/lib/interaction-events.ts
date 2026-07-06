/**
 * Interaction event layer.
 *
 * Every meaningful gesture emits a named event through this bus. Today
 * the default sink maps events to the Vibration API where available;
 * a native shell (Capacitor/React Native webview) can replace the sink
 * with real haptics without touching any product code.
 */

export type InteractionEvent =
  | "like"
  | "pass"
  | "superlike"
  | "match"
  | "undo"
  | "profile-open"
  | "photo-expand"
  | "message-send"
  | "step-complete"
  | "milestone"
  | "celebration";

type Listener = (event: InteractionEvent) => void;

const listeners = new Set<Listener>();

export function onInteraction(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitInteraction(event: InteractionEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // a faulty sink must never break the product
    }
  }
  defaultHapticSink(event);
}

/** Vibration patterns tuned per gesture (ms). Silently no-ops on desktop/iOS web. */
const PATTERNS: Partial<Record<InteractionEvent, number | number[]>> = {
  like: 12,
  pass: 8,
  superlike: [12, 40, 18],
  match: [16, 60, 16, 60, 28],
  undo: 10,
  "message-send": 8,
  "step-complete": 10,
  milestone: [10, 50, 14],
  celebration: [16, 60, 16, 60, 28],
};

let hapticsEnabled = true;

/** A native shell may disable the web fallback before installing its own sink. */
export function setWebHaptics(enabled: boolean): void {
  hapticsEnabled = enabled;
}

function defaultHapticSink(event: InteractionEvent): void {
  if (!hapticsEnabled || typeof navigator === "undefined") return;
  const pattern = PATTERNS[event];
  if (pattern && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* unsupported - fine */
    }
  }
}
