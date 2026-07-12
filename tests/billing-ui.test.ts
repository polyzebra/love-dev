/**
 * Static contract tests for the checkout UX (phase 2 of the Stripe
 * milestone). No server needed - these read the source and pin the
 * decisions:
 *   npx tsx tests/billing-ui.test.ts
 *
 * 1. Spec case 6 - the checkout CTA reserves its size: BOTH the idle
 *    label and the loading label are always rendered, stacked in the
 *    same grid cell, so toggling aria-busy can never change the button's
 *    width or height. No white pill, no skeleton, aria-busy + disabled
 *    during flight, calm INLINE error (not toast-only), retry allowed.
 * 2. Spec case 20 - the subscription page reflects seeded state
 *    immediately: force-dynamic, no "use cache", fresh Subscription +
 *    Payment reads every render, effective-tier policy (the same one the
 *    entitlement gates use), exact "Tirvea Free/Plus/Gold" naming.
 * 3. The confirm page never fakes success: redirect to /discover happens
 *    ONLY in the ACTIVE branch, missing session_id renders
 *    SESSION_INVALID, and PENDING keeps polling / goes honest-slow.
 * 4. Pricing copy honesty: features that do not exist (boosts, see who
 *    liked you, priority discovery, sharper filters) appear nowhere in
 *    the plan catalogue or the pricing surfaces.
 * 5. One price source: stripe.ts derives PLAN_PRICE_EXPECTATIONS from
 *    PLANS instead of hardcoding amounts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

/** Comments may NAME banned things (they document the honesty rule). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'])\/\/.*$/gm, "$1");
}

function read(...segments: string[]): string {
  return readFileSync(join(ROOT, ...segments), "utf8");
}

// ---------------------------------------------------------------------------
console.log("spec case 6 - CheckoutButton loading state retains size");
// ---------------------------------------------------------------------------

const checkoutButton = read("src", "components", "billing", "checkout-button.tsx");

check("both labels are stacked in the same grid cell (size reserved from first paint)", () => {
  const stacked = checkoutButton.match(/col-start-1 row-start-1/g) ?? [];
  assert.ok(
    stacked.length >= 2,
    "expected the idle label AND the loading label to occupy the same grid cell",
  );
  assert.match(checkoutButton, /"grid max-w-full place-items-center"/);
});

check("inactive layer is hidden with `invisible` (keeps geometry), never unmounted", () => {
  assert.match(checkoutButton, /busy && "invisible"/);
  assert.match(checkoutButton, /!busy && "invisible"/);
  const code = stripComments(checkoutButton);
  assert.ok(!/\{busy \? [^:]+ : /.test(code), "labels must not be swapped conditionally");
});

check("loading swaps label for spinner + 'Opening secure checkout...' inline", () => {
  assert.match(checkoutButton, /Opening secure checkout\.\.\./);
  assert.match(checkoutButton, /animate-spin/);
});

check("aria-busy + disabled during flight, 44px minimum target", () => {
  assert.match(checkoutButton, /aria-busy=\{busy\}/);
  assert.match(checkoutButton, /disabled=\{busy\}/);
  assert.match(checkoutButton, /min-h-11/);
});

check("no white pill / skeleton anywhere in the CTA", () => {
  const code = stripComments(checkoutButton);
  assert.ok(!/bg-white/.test(code), "no white pill");
  assert.ok(!/skeleton/i.test(code), "no skeleton");
});

check("success path redirects via window.location.assign(data.url)", () => {
  assert.match(checkoutButton, /window\.location\.assign\(payload\.data\.url\)/);
});

check("401 -> /login with an encoded same-origin callbackUrl", () => {
  assert.match(checkoutButton, /res\.status === 401/);
  assert.match(checkoutButton, /\/login\?callbackUrl=\$\{encodeURIComponent\(here\)\}/);
});

check("409 already_subscribed -> billing portal (with a toast), not an error", () => {
  assert.match(checkoutButton, /res\.status === 409/);
  assert.match(checkoutButton, /\/api\/billing\/portal/);
  assert.match(checkoutButton, /toast\(/);
});

check("errors restore the CTA with a calm INLINE live-region message; no redirect", () => {
  assert.match(checkoutButton, /setBusy\(false\)/);
  assert.match(checkoutButton, /aria-live="polite"/);
  assert.match(checkoutButton, /role="status"/);
  assert.match(checkoutButton, /Nothing was charged/);
});

// ---------------------------------------------------------------------------
console.log("spec case 20 - subscription page reflects persisted state immediately");
// ---------------------------------------------------------------------------

const subPage = read("src", "app", "(app)", "settings", "subscription", "page.tsx");

check("page is force-dynamic and never cached", () => {
  assert.match(subPage, /export const dynamic = "force-dynamic"/);
  assert.ok(!/use cache/.test(subPage), "no use cache directive");
  assert.ok(!/unstable_cache|revalidate\s*=/.test(subPage), "no cache/revalidate APIs");
});

check("reads fresh Subscription AND Payment rows on every render", () => {
  assert.match(subPage, /db\.subscription\.findUnique/);
  assert.match(subPage, /db\.payment\.findMany/);
});

check("displays the EFFECTIVE tier via the same policy the gates use", () => {
  assert.match(subPage, /effectiveTier\(subscription\)/);
  assert.match(
    subPage,
    /from "@\/lib\/services\/entitlements"/,
    "must reuse the canonical policy, not re-derive it",
  );
});

check("exact plan naming comes from PLANS (Tirvea Free/Plus/Gold, no bare 'Tirvea' chip)", () => {
  assert.match(subPage, /PLANS\.find/);
  const constants = read("src", "lib", "constants", "index.ts");
  assert.match(constants, /name: "Tirvea Free"/);
  assert.match(constants, /name: "Tirvea Plus"/);
  assert.match(constants, /name: "Tirvea Gold"/);
  assert.ok(!/name: "Tirvea",/.test(constants), "no ambiguous bare 'Tirvea' plan name");
});

check("'No payments yet' only when the Payment list is truly empty", () => {
  assert.match(subPage, /payments\.length === 0 \?/);
  assert.match(subPage, /No payments yet\./);
});

check("cancelAtPeriodEnd and PAST_DUE grace states have honest copy", () => {
  assert.match(subPage, /cancelAtPeriodEnd/);
  assert.match(subPage, /Cancels on/);
  assert.match(subPage, /PAST_DUE/);
  assert.match(subPage, /didn(?:'|&apos;)t go through/);
});

check("upgrade CTAs are the shared CheckoutButton; billing runs through the portal button", () => {
  assert.match(subPage, /<CheckoutButton/);
  assert.match(subPage, /<ManageBillingButton/);
});

check("price comes from the single PLANS source (no hardcoded 14.99/29.99)", () => {
  assert.ok(!/14\.99|29\.99|1499|2999/.test(stripComments(subPage)));
  assert.match(subPage, /priceMonthlyCents/);
  const stripe = read("src", "lib", "stripe.ts");
  assert.match(stripe, /planPriceCents\("PLUS"\)/);
  assert.match(stripe, /planPriceCents\("GOLD"\)/);
  assert.ok(
    !/amountCents: (1499|2999)/.test(stripe),
    "stripe.ts must derive prices from PLANS",
  );
});

// ---------------------------------------------------------------------------
console.log("confirm page state machine never fakes success");
// ---------------------------------------------------------------------------

const confirm = read("src", "components", "billing", "checkout-confirm.tsx");
const confirmPage = read(
  "src",
  "app",
  "(app)",
  "settings",
  "subscription",
  "confirm",
  "page.tsx",
);

check("all five server states + slow-pending + unreachable are handled", () => {
  for (const s of [
    '"CHECKING"',
    '"ACTIVE"',
    '"PENDING_SLOW"',
    '"FAILED"',
    '"CANCELED"',
    '"SESSION_INVALID"',
    '"UNREACHABLE"',
  ]) {
    assert.ok(confirm.includes(s), `state ${s} missing`);
  }
});

check("redirect to /discover exists ONLY in the verified-ACTIVE branch", () => {
  const pushes = stripComments(confirm).match(/router\.push\("\/discover"\)/g) ?? [];
  assert.equal(pushes.length, 1, "exactly one /discover redirect");
  assert.match(confirm, /outcome\.state\.kind === "ACTIVE"/);
  // PENDING never redirects - it either keeps polling or goes honest-slow.
  assert.match(confirm, /PENDING_SLOW/);
});

check("success refreshes subscription state (router.refresh) before moving on", () => {
  assert.match(confirm, /router\.refresh\(\)/);
});

check("polls every 2s with a ~25s budget; Check again + settings link on slow", () => {
  assert.match(confirm, /POLL_INTERVAL_MS = 2_000/);
  assert.match(confirm, /INITIAL_BUDGET_MS = 25_000/);
  assert.match(confirm, /Check again/);
  assert.match(confirm, /Go to subscription settings/);
  assert.match(confirm, /taking a little longer than usual/);
});

check("missing session_id renders SESSION_INVALID without any network call", () => {
  assert.match(confirm, /sessionId \? \{ kind: "CHECKING" \} : \{ kind: "SESSION_INVALID" \}/);
});

check("server shell requires the full gate (requireUser) and spec'd copy exists", () => {
  assert.match(confirmPage, /await requireUser\(\)/);
  assert.match(confirm, /Confirming your Tirvea membership/);
  assert.match(
    confirm,
    /We've received your return from Stripe\. We're securely confirming your subscription\./,
  );
});

// ---------------------------------------------------------------------------
console.log("pricing copy honesty - nothing that doesn't exist is sold");
// ---------------------------------------------------------------------------

const constantsSrc = stripComments(read("src", "lib", "constants", "index.ts"));
const spotlightSrc = stripComments(
  read("src", "components", "marketing", "pricing-spotlight.tsx"),
);

check("no boosts, see-who-liked, priority discovery or sharper filters in plan copy", () => {
  for (const banned of [
    /boost/i,
    /see who/i,
    /already waiting for you/i,
    /priority discovery/i,
    /shown to more/i,
    /sharper filters/i,
    /be seen first/i,
  ]) {
    assert.ok(!banned.test(constantsSrc), `constants sells ${banned}`);
    assert.ok(!banned.test(spotlightSrc), `pricing spotlight sells ${banned}`);
  }
});

check("real feature set is sold instead: unlimited likes, rewind, super likes, first messages", () => {
  assert.match(constantsSrc, /without a daily cap/);
  assert.match(constantsSrc, /Rewind/);
  assert.match(constantsSrc, /5 Super Likes a day/);
  assert.match(constantsSrc, /10 Super Likes a day/);
  assert.match(constantsSrc, /3 first messages a day/);
  assert.match(constantsSrc, /10 first messages a day/);
  assert.match(constantsSrc, /25 first messages a day/);
});

check("first messages are phrased as 'more', never exclusive (FREE has 3/day)", () => {
  assert.match(constantsSrc, /FREE: 3/);
  assert.ok(
    !/(say hello before you match[^"]*")[^]*only/i.test(constantsSrc),
    "no exclusivity claim",
  );
  assert.ok(
    !/unlock first messages|exclusive/i.test(constantsSrc + spotlightSrc),
    "first messages must not be sold as paid-only",
  );
});

check("paid CTAs on the pricing spotlight are the real CheckoutButton, not /login links", () => {
  assert.match(spotlightSrc, /<CheckoutButton/);
  assert.ok(
    !/Get \$\{plan\.name\}|href="\/login"[^]*Get /.test(spotlightSrc),
    "paid plans must not link to /login",
  );
});

console.log(`\nbilling-ui: ${passed} checks passed`);
