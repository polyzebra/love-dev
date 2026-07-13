import { after } from "next/server";

/**
 * Infrastructure adapter (Phase 0K): "run this after the current HTTP
 * response is flushed". Domain services must not import Next.js - they
 * import THIS seam instead, and the framework dependency lives in one
 * allowlisted adapter module (see tests/architecture.test.ts).
 *
 * Inside a Next request scope the work rides `after()` (never delays
 * the response); anywhere else - tests, scripts, cron handlers outside
 * a request - it runs as a detached promise, so callers never care.
 */
export function deferAfterResponse(task: () => void | Promise<unknown>): void {
  const run = () => {
    try {
      const result = task();
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        (result as Promise<unknown>).catch((error) =>
          console.error("[defer] deferred task failed:", error),
        );
      }
    } catch (error) {
      console.error("[defer] deferred task failed:", error);
    }
  };
  try {
    after(run);
  } catch {
    run();
  }
}
