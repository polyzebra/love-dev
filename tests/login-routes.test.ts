/**
 * Live route tests for the /login entry consolidation. Run with the dev
 * server up on :3000:
 *   npx tsx tests/login-routes.test.ts
 *
 * Plain fetch, no browser: redirects are asserted via status + Location
 * (redirect: "manual"), entry dedupe via the SSR HTML. UA strings are
 * labeled mobile vs desktop to prove there is no device branching.
 */
import assert from "node:assert/strict";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

const UA = {
  mobile:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  desktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
} as const;

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

function get(path: string, ua: keyof typeof UA) {
  return fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: { "user-agent": UA[ua] },
  });
}

/** Location header, normalized to path?query (dev returns absolute URLs). */
function location(res: Response): string {
  const raw = res.headers.get("location");
  assert.ok(raw, "expected a Location header");
  const url = new URL(raw, BASE);
  return url.pathname + url.search;
}

async function main() {
  console.log("legacy /auth normalization (route handler + middleware)");

  await check("/auth (mobile UA) -> 308 /login", async () => {
    const res = await get("/auth", "mobile");
    assert.equal(res.status, 308);
    assert.equal(location(res), "/login");
  });

  await check("/auth (desktop UA) -> 308 /login (same for every device)", async () => {
    const res = await get("/auth", "desktop");
    assert.equal(res.status, 308);
    assert.equal(location(res), "/login");
  });

  await check("/auth?next=/messages carries the safe relative param", async () => {
    const res = await get("/auth?next=/messages", "mobile");
    assert.equal(res.status, 308);
    assert.equal(location(res), "/login?next=%2Fmessages");
  });

  await check("/auth?next=https://evil.example drops the absolute URL", async () => {
    const res = await get("/auth?next=https%3A%2F%2Fevil.example", "mobile");
    assert.equal(res.status, 308);
    assert.equal(location(res), "/login");
  });

  await check("/auth?next=//evil drops the protocol-relative URL", async () => {
    const res = await get("/auth?next=%2F%2Fevil", "mobile");
    assert.equal(res.status, 308);
    assert.equal(location(res), "/login");
  });

  await check("/auth/email-code?email=x -> 308 /login/email/verify?email=x", async () => {
    const res = await get("/auth/email-code?email=x%40example.com", "mobile");
    assert.equal(res.status, 308);
    assert.equal(location(res), "/login/email/verify?email=x%40example.com");
  });

  console.log("protected-route gate");

  await check("unauthenticated GET /discover -> 307 /login?callbackUrl=%2Fdiscover", async () => {
    const res = await get("/discover", "mobile");
    assert.equal(res.status, 307);
    assert.equal(location(res), "/login?callbackUrl=%2Fdiscover");
  });

  console.log("entry dedupe (SSR HTML)");

  await check("/login/email has NO provider buttons (no 'Continue with Google')", async () => {
    const res = await get("/login/email", "mobile");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(!html.includes("Continue with Google"), "/login/email must not render Google");
    assert.ok(html.includes("What's your email?") || html.includes("What&#x27;s your email?"));
  });

  await check("/login renders the phone row (PHONE_LOGIN_ENABLED=true)", async () => {
    const res = await get("/login", "mobile");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("Continue with phone number"), "/login must render the phone row");
    assert.ok(html.includes("Continue with Google"), "/login owns the Google button");
    assert.ok(html.includes("Continue with Email"), "/login owns the email row");
  });

  console.log("login chooser: exactly one legal notice, providers render immediately");
  await check(
    "/login renders exactly ONE legal notice (card owns it; layout footer suppressed)",
    async () => {
      const res = await get("/login", "mobile");
      assert.equal(res.status, 200);
      const html = await res.text();
      const notices = html.split("By continuing").length - 1;
      assert.equal(notices, 1, `expected exactly one legal notice, found ${notices}`);
      // The canonical card notice keeps all three required links.
      assert.ok(html.includes("Cookie Policy"), "Cookie Policy link preserved");
      assert.ok(html.includes("Terms of Use"), "Terms link preserved");
    },
  );
  await check("/login paints Google/Email/phone immediately (no lone spinner slot)", async () => {
    const res = await get("/login", "mobile");
    const html = await res.text();
    // The button label is in the SSR HTML - the provider renders from
    // server/build config, not behind a client availability fetch.
    assert.ok(html.includes("Continue with Google"), "Google label rendered server-side");
    assert.ok(html.includes("Continue with Email"), "Email rendered");
    assert.ok(html.includes("Continue with phone number"), "phone rendered");
  });

  console.log("email-attach step is never a trap - it always offers exits");
  await check("/auth/email renders 'Back to sign-in options' and 'Sign out' exits", async () => {
    const res = await get("/auth/email", "mobile");
    assert.equal(res.status, 200);
    const html = await res.text();
    // A failed OPTIONAL email-attach must never strip every navigation exit.
    assert.ok(html.includes("Back to sign-in options"), "must offer a way back to the chooser");
    assert.ok(html.includes("Sign out"), "must offer a full sign-out");
  });

  console.log(`\n${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
