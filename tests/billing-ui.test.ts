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

check("reads fresh state on every render - Stripe is the source of truth, not the local DB", () => {
  // reconcileBilling re-syncs the subscription AND invoice history from
  // Stripe on view (throttled), then falls back to the cached row.
  assert.match(subPage, /reconcileBilling\(user\.id\)/);
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
  assert.match(subPage, /stays active until/);
  assert.match(subPage, /PAST_DUE/);
  assert.match(subPage, /didn(?:'|&apos;)t go through/);
});

check("upgrade CTAs are the shared pricing spotlight (whose paid CTAs are Checkout/UpgradePlan buttons); billing runs through the portal button", () => {
  // The upgrade section embeds the ONE plan-card surface - no duplicated
  // Plus/Gold markup on the settings page. CheckoutButton/UpgradePlanButton
  // live inside PricingSpotlight (pinned below in the pricing honesty and
  // upgrade-path sections).
  assert.match(subPage, /<PricingSpotlight\s+variant="embedded"/);
  assert.ok(
    !/<CheckoutButton|<UpgradePlanButton/.test(subPage),
    "no second copy of the upgrade CTA outside the shared spotlight",
  );
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

// ---------------------------------------------------------------------------
console.log("upgrade path - in-place plan change, one canonical hierarchy");
// ---------------------------------------------------------------------------

const upgradeButton = read("src", "components", "billing", "upgrade-plan-button.tsx");
const pricingPage = read("src", "app", "(marketing)", "pricing", "page.tsx");

check("plan cards derive from the canonical hierarchy, never a hand-rolled list", () => {
  // Both the tiers shown and the upgrade targets come from
  // planRank/upgradePlansFor (lib/constants) - adding a tier to PLANS
  // propagates to every surface without touching this component.
  assert.match(spotlightSrc, /upgradePlansFor\(/);
  assert.match(spotlightSrc, /planRank\(/);
});

check("members with a live subscription upgrade IN PLACE - no portal detour to discover Gold", () => {
  assert.match(spotlightSrc, /<UpgradePlanButton/);
  assert.match(upgradeButton, /\/api\/billing\/change-plan/);
  assert.ok(
    !/\/api\/billing\/portal/.test(stripComments(upgradeButton)),
    "the upgrade CTA must never fall back to the portal",
  );
});

check("the current plan is labelled, never sold back (no CTA to buy what you hold)", () => {
  assert.match(spotlightSrc, /Your current plan/);
  assert.match(spotlightSrc, /currentTier === plan\.tier/);
});

check("upgrade CTA copy is exact and proration is honest", () => {
  assert.match(upgradeButton, /Upgrade to \$\{planName\}/);
  assert.match(spotlightSrc, /you only pay the difference/);
  assert.match(spotlightSrc, /Same renewal date/);
});

check("UpgradePlanButton keeps the calm CTA contract (size reserved, aria-busy, inline error)", () => {
  const stacked = upgradeButton.match(/col-start-1 row-start-1/g) ?? [];
  assert.ok(stacked.length >= 2, "both labels stacked in the same grid cell");
  assert.match(upgradeButton, /aria-busy=\{busy\}/);
  assert.match(upgradeButton, /disabled=\{busy\}/);
  assert.match(upgradeButton, /aria-live="polite"/);
  assert.match(upgradeButton, /res\.status === 401/);
  assert.match(upgradeButton, /router\.refresh\(\)/);
});

check("settings page decides the upgrade path via the SHARED live-subscription predicate", () => {
  assert.match(subPage, /hasLiveSubscription\(subscription\)/);
  assert.match(subPage, /from "@\/lib\/services\/billing"/);
  assert.ok(
    !/\["ACTIVE", "TRIALING", "PAST_DUE"\]/.test(stripComments(subPage)),
    "no re-derived status list on the page",
  );
  assert.match(subPage, /upgradePlansFor\(/);
});

check("pricing page is plan-aware: current tier + live-sub state feed the spotlight", () => {
  assert.match(pricingPage, /effectiveTier\(subscription\)/);
  assert.match(pricingPage, /hasLiveSubscription\(subscription\)/);
  assert.match(pricingPage, /currentTier=\{currentTier\}/);
  assert.match(pricingPage, /hasLiveSub=\{hasLiveSub\}/);
});

// ---------------------------------------------------------------------------
console.log("subscription lifecycle - every state has an honest surface");
// ---------------------------------------------------------------------------

const resumeButton = read("src", "components", "billing", "resume-subscription-button.tsx");
const retryButton = read("src", "components", "billing", "retry-payment-button.tsx");
const actionButton = read("src", "components", "billing", "billing-action-button.tsx");
const constantsFull = read("src", "lib", "constants", "index.ts");

check("all six lifecycle states exist with their spec'd badges", () => {
  for (const s of ['"FREE"', '"ACTIVE"', '"TRIAL"', '"ENDING"', '"PAYMENT_REQUIRED"', '"EXPIRED"']) {
    assert.ok(subPage.includes(s), `lifecycle state ${s} missing`);
  }
  for (const label of ['"Active"', '"Trial"', '"Ending"', '"Payment required"', '"Free plan"']) {
    assert.ok(subPage.includes(label), `badge ${label} missing`);
  }
});

check("ENDING: stays-active-until hero, countdown, resume + manage, derived lose-list", () => {
  assert.match(subPage, /stays active until/);
  assert.match(subPage, /automatically returns to Tirvea Free/);
  assert.match(subPage, /days left/);
  assert.match(subPage, /<ResumeSubscriptionButton/);
  assert.match(subPage, /you will[\s\S]{0,40}lose:/);
  // The list derives from the entitlement tables, never hand-written fear copy.
  assert.match(subPage, /downgradeLossesFor\(/);
  assert.match(constantsFull, /export function downgradeLossesFor/);
  assert.ok(
    !/miss out|don't lose|last chance|hurry/i.test(stripComments(subPage)),
    "no fear tactics",
  );
});

check("resume = ONE Stripe subscription update, never a portal detour or new checkout", () => {
  assert.match(resumeButton, /\/api\/billing\/resume/);
  assert.ok(!/\/api\/billing\/portal/.test(stripComments(resumeButton)));
  assert.ok(!/checkout/i.test(stripComments(resumeButton)));
});

check("PAYMENT REQUIRED: honest explanation + update payment method + retry", () => {
  assert.match(subPage, /We couldn(?:'|&apos;)t renew your subscription\./);
  assert.match(subPage, /Update payment method/);
  assert.match(subPage, /<RetryPaymentButton/);
  assert.match(subPage, /flow="payment_method_update"/);
  assert.match(retryButton, /\/api\/billing\/retry-payment/);
});

check("EXPIRED: the prior plan's end is told from kept Stripe state, upgrade path returns", () => {
  assert.match(subPage, /planForPriceId\(subscription\?\.stripePriceId\)/);
  assert.match(subPage, /membership ended/);
  assert.match(subPage, /Upgrade again anytime/);
});

check("TRIAL: countdown to the first billing date", () => {
  assert.match(subPage, /Trial ends in \$\{daysUntil\(trialEnd\)\} days/);
});

check("action buttons keep the calm CTA contract (size reserved, aria-busy, inline error)", () => {
  const stacked = actionButton.match(/col-start-1 row-start-1/g) ?? [];
  assert.ok(stacked.length >= 2);
  assert.match(actionButton, /aria-busy=\{busy\}/);
  assert.match(actionButton, /aria-live="polite"/);
  assert.match(actionButton, /router\.refresh\(\)/);
  assert.match(actionButton, /res\.status === 401/);
});

check("payment history: date, plan, amount, currency, paid state, receipt AND invoice links", () => {
  assert.match(subPage, /money\(p\.amountCents, p\.currency\)/);
  assert.match(subPage, /p\.currency\.toUpperCase\(\)/);
  assert.match(subPage, /p\.receiptUrl/);
  assert.match(subPage, /p\.invoiceUrl/);
  assert.match(subPage, />[\s]*Receipt[\s]*</);
  assert.match(subPage, />[\s]*Invoice[\s]*</);
  assert.match(subPage, /PAYMENT_LABEL\[p\.status\]/);
});

console.log(`\nbilling-ui: ${passed} checks passed`);
