/**
 * The login chooser's OAuth-launch state must be transient and self-healing
 * so a stuck Google spinner can never survive a canceled OAuth, browser
 * Back, or iOS Safari BFCache restore. There is no WebKit/jsdom harness in
 * this repo, so this suite source-scans the exact lifecycle wiring that the
 * behaviour depends on (the runtime behaviour is exercised in the live
 * mobile verification). Run with:
 *   npx tsx tests/login-entry-lifecycle.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  const login = readFileSync("src/components/auth/LoginEntry.tsx", "utf8");
  const footer = readFileSync("src/components/auth/AuthChromeFooter.tsx", "utf8");
  const layout = readFileSync("src/app/(auth)/layout.tsx", "utf8");

  console.log("OAuth launch state is transient + starts idle");
  await check("pending starts null on every mount (no initial loading state)", () => {
    assert.ok(
      /useState<"google" \| "apple" \| null>\(null\)/.test(login),
      "pending must initialise to null",
    );
  });
  await check(
    "only the tapped provider spins (per-provider pending, not a generic boolean)",
    () => {
      assert.ok(login.includes('pending === "google"'), "google button keys off pending===google");
      assert.ok(login.includes("setPending(provider)"), "only the tapped provider is set pending");
    },
  );

  console.log("self-healing recovery signals are wired");
  await check("BFCache restore (pageshow persisted) resets the launch spinner", () => {
    assert.ok(login.includes('"pageshow"'), "listens for pageshow");
    assert.ok(login.includes("e.persisted"), "resets specifically on a BFCache restore");
  });
  await check("returning to the tab (visibilitychange/focus) resets the launch spinner", () => {
    assert.ok(login.includes('"visibilitychange"'), "listens for visibilitychange");
    assert.ok(login.includes('"focus"'), "listens for focus");
  });
  await check("a bounded launch timeout un-sticks the button if no navigation occurs", () => {
    assert.ok(login.includes("OAUTH_LAUNCH_TIMEOUT_MS"), "a bounded timeout exists");
    assert.ok(/setTimeout\(/.test(login), "the timeout is armed on launch");
    assert.ok(/clearTimeout\(/.test(login), "and cleared (on error/unmount) - no leak");
  });
  await check("OAuth failure shows a neutral retryable message, no provider internals", () => {
    assert.ok(
      login.includes("sign-in is temporarily unavailable. Try again."),
      "neutral retryable copy on failure",
    );
  });

  console.log("no persisted / shared loading state");
  await check("launch state is never persisted to storage", () => {
    assert.ok(!/localStorage|sessionStorage/.test(login), "no localStorage/sessionStorage");
  });

  console.log("exactly one legal notice on the chooser");
  await check("the global auth footer suppresses itself on /login (card owns the notice)", () => {
    assert.ok(footer.includes('pathname === "/login"'), "footer checks the path");
    assert.ok(
      /if \(pathname === "\/login"\) return null;/.test(footer),
      "and renders nothing there",
    );
    assert.ok(layout.includes("<AuthChromeFooter />"), "layout uses the suppressible footer");
    assert.ok(
      !/By continuing you agree/.test(layout),
      "layout no longer inlines a duplicate notice",
    );
  });
  await check("the chooser's own notice keeps Terms, Privacy AND Cookie links", () => {
    assert.ok(login.includes("Terms of Use"), "Terms");
    assert.ok(login.includes("Privacy Policy"), "Privacy");
    assert.ok(login.includes("Cookie Policy"), "Cookie");
  });

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
