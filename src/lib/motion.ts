/**
 * The house motion language. One easing curve, three spring weights.
 * Every animated component imports from here — nothing defines its own
 * physics, so every movement in the product feels made by one hand.
 */

/** Expo-out — entrances, reveals, crossfades. */
export const EASE_LUXE = [0.16, 1, 0.3, 1] as const;

/** Springs by perceived mass. */
export const SPRING = {
  /** Ambient drift — parallax layers, large surfaces. */
  soft: { type: "spring", stiffness: 60, damping: 18 } as const,
  /** Standard UI — cards, sheets, halos, list items. */
  standard: { type: "spring", stiffness: 320, damping: 28 } as const,
  /** Snappy accents — chips, badges, icons popping in. */
  snappy: { type: "spring", stiffness: 420, damping: 24 } as const,
  /** Celebration — hearts, match moments; a touch of overshoot. */
  bounce: { type: "spring", stiffness: 300, damping: 14 } as const,
} as const;
