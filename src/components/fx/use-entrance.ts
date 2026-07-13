"use client";

import { useEffect, useState } from "react";

// Module-level: flips true at the FIRST client mount after a hard page
// load and stays true for the lifetime of the tab.
let hydratedOnce = false;

/**
 * Should an entrance animation run for this mount?
 *
 * framer-motion serializes `initial` into the SERVER-rendered HTML - an
 * `initial={{ opacity: 0 }}` entrance therefore paints a hard-loaded
 * page with its content inline-hidden (opacity:0 in the HTML itself)
 * until the JS bundle downloads and hydrates. On a phone that is
 * seconds of blank card. (This is exactly the /login blank-white-card
 * bug: the glass card is server-rendered visible, its content
 * server-rendered invisible.)
 *
 * Returns false during SSR and the hydration render of a hard
 * navigation - pass `initial={false}` then, so the first paint is the
 * finished layout. Returns true for every mount after hydration
 * (client-side navigations, in-page step swaps), where entrances
 * animate exactly as designed.
 */
export function useEntranceAnimatable(): boolean {
  const [animatable, setAnimatable] = useState(() => hydratedOnce);
  useEffect(() => {
    hydratedOnce = true;
    // Flip on the next frame (never synchronously in the effect - that
    // cascades a render during hydration). In-page step swaps that
    // happen after this animate as designed.
    const raf = requestAnimationFrame(() => setAnimatable(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return animatable;
}
