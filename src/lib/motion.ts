/**
 * The house motion language. One easing family, one spring family,
 * four durations. Every animated component imports from here - nothing
 * defines its own physics, so every movement in the product feels made
 * by one hand.
 *
 * WHAT TO ANIMATE (and with what):
 *   - Modals / bottom sheets ............ sheetSpring (or SPRING.standard)
 *   - Tab indicators / segmented pills .. cardSpring
 *   - Card stack (swipe deck) ........... cardSpring, exits with EASE_LUXE
 *   - Match moment / Like celebration ... SPRING.bounce (the ONLY overshoot)
 *   - Notifications / toasts ............ cardSpring in, fast fade out
 *   - Expandables / accordions .......... standardEase at DURATIONS.standard
 *   - Skeleton -> content swap .......... crossfade, subtleEase at DURATIONS.fast
 *   - Page/section reveals .............. EASE_LUXE (see fx/reveal)
 *
 * WHAT NOT TO ANIMATE:
 *   - Every text block (reveals are for hero/section moments, not paragraphs)
 *   - Tables and dense admin lists
 *   - Settings rows and form fields
 *   - Hover transforms on non-interactive surfaces
 *   - Anything the user reads while it moves
 *
 * REDUCED MOTION: CSS animations are globally killed by the
 * prefers-reduced-motion block in globals.css, but that does NOT stop
 * JS-driven motion/react animations. Components with spatial movement
 * (slide/scale/shake/parallax) must gate on useReducedMotion() from
 * motion/react - opacity-only crossfades are fine to keep.
 */

/** Expo-out - entrances, reveals, crossfades. The house curve. */
export const EASE_LUXE = [0.16, 1, 0.3, 1] as const;

/**
 * Easing aliases by intent. `standardEase` IS the house curve;
 * `subtleEase` is a quieter cubic ease-out for small, short moves
 * (crossfades, skeleton swaps, opacity shifts) where expo-out would
 * feel dramatic.
 */
export const subtleEase = [0.33, 1, 0.68, 1] as const;
export const standardEase = EASE_LUXE;

/**
 * Duration scale (seconds). Pair with subtleEase/standardEase.
 *   instant    - micro feedback: icon swaps, checkmark ticks
 *   fast       - small elements: chips, tooltips, skeleton crossfades
 *   standard   - most UI: expandables, dropdowns, list items
 *   deliberate - large surfaces: modals, full-panel transitions
 */
export const DURATIONS = {
  instant: 0.1,
  fast: 0.16,
  standard: 0.24,
  deliberate: 0.34,
} as const;

/** Springs by perceived mass. */
export const SPRING = {
  /** Ambient drift - parallax layers, large surfaces. */
  soft: { type: "spring", stiffness: 60, damping: 18 } as const,
  /** Standard UI - cards, sheets, halos, list items. */
  standard: { type: "spring", stiffness: 320, damping: 28 } as const,
  /** Snappy accents - chips, badges, icons popping in. */
  snappy: { type: "spring", stiffness: 420, damping: 24 } as const,
  /** Celebration - hearts, match moments; a touch of overshoot. */
  bounce: { type: "spring", stiffness: 300, damping: 14 } as const,
} as const;

/**
 * Spring aliases by surface. Same physics family as SPRING - use
 * whichever name reads better at the call site.
 *   softSpring  - ambient drift, parallax (=== SPRING.soft)
 *   cardSpring  - cards, tab indicators, list items (=== SPRING.standard)
 *   sheetSpring - bottom sheets, drawers, modals: a touch heavier and
 *                 more damped so large surfaces settle without wobble
 */
export const softSpring = SPRING.soft;
export const cardSpring = SPRING.standard;
export const sheetSpring = {
  type: "spring",
  stiffness: 260,
  damping: 30,
} as const;
