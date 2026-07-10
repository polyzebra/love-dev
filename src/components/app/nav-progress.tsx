"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useLinkStatus } from "next/link";
import { cn } from "@/lib/utils";

/**
 * Non-blocking route-transition feedback. The (app) group has NO
 * loading.tsx on purpose: without one, the App Router keeps the previous
 * page fully visible and interactive while the next route's RSC payload
 * streams in - no full-screen spinner, no blank content area. This bar is
 * the only transition signal: a 2px strip under the top edge that starts
 * after 150ms (so sub-150ms navs show nothing) and completes when the
 * route lands.
 *
 * Wiring: wrap the nav in <NavTransitionProvider>; drop <NavLinkStatus />
 * inside every <Link> whose navigation should report progress
 * (useLinkStatus must be rendered as a descendant of the Link it tracks).
 */

const SetPendingContext = createContext<Dispatch<SetStateAction<number>>>(() => {});

export function NavTransitionProvider({ children }: { children: ReactNode }) {
  const [pendingCount, setPendingCount] = useState(0);
  return (
    <SetPendingContext.Provider value={setPendingCount}>
      <NavProgressBar active={pendingCount > 0} />
      {children}
    </SetPendingContext.Provider>
  );
}

/** Renders nothing; reports its parent Link's pending state to the bar. */
export function NavLinkStatus() {
  const { pending } = useLinkStatus();
  const setPending = useContext(SetPendingContext);
  useEffect(() => {
    if (!pending) return;
    setPending((n) => n + 1);
    return () => setPending((n) => n - 1);
  }, [pending, setPending]);
  return null;
}

function NavProgressBar({ active }: { active: boolean }) {
  // Three-phase machine so the bar finishes (snaps to 100% and fades)
  // instead of vanishing mid-flight when the navigation commits. Phase
  // transitions happen at render time (React's "storing information from
  // previous renders" pattern); only the done->idle decay is async.
  const [phase, setPhase] = useState<"idle" | "active" | "done">("idle");
  const [prevActive, setPrevActive] = useState(false);
  if (active !== prevActive) {
    setPrevActive(active);
    setPhase(active ? "active" : phase === "active" ? "done" : "idle");
  }

  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => setPhase("idle"), 320);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "idle") return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5"
    >
      <div
        className={cn(
          "h-full origin-left rounded-r-full bg-primary shadow-[0_0_8px_rgba(225,29,72,0.55)]",
          phase === "active" && "animate-nav-progress",
          phase === "done" &&
            "scale-x-100 opacity-0 transition-[opacity] duration-300 ease-out",
        )}
      />
    </div>
  );
}
