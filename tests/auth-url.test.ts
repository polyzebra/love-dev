/**
 * Tests for the production-hardened auth URL resolution. Run with:
 *   npx tsx tests/auth-url.test.ts
 *
 * No database, no network - pure env simulation. Each case mutates
 * process.env (and optionally stubs globalThis.window), asserts, and the
 * suite restores everything afterwards.
 */
import assert from "node:assert/strict";
import { authRedirectUrl, siteUrl } from "../src/lib/auth/url";

const env = process.env as Record<string, string | undefined>;
const SAVED = {
  NODE_ENV: env.NODE_ENV,
  NEXT_PUBLIC_SITE_URL: env.NEXT_PUBLIC_SITE_URL,
  VERCEL_URL: env.VERCEL_URL,
};

type Case = {
  nodeEnv?: string;
  site?: string;
  vercel?: string;
  windowOrigin?: string;
};

const globalAny = globalThis as { window?: unknown };
const savedWindow = globalAny.window;
const savedConsoleError = console.error;

let errors: string[] = [];

function setup(c: Case) {
  errors = [];
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  if (c.nodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = c.nodeEnv;
  if (c.site === undefined) delete env.NEXT_PUBLIC_SITE_URL;
  else env.NEXT_PUBLIC_SITE_URL = c.site;
  if (c.vercel === undefined) delete env.VERCEL_URL;
  else env.VERCEL_URL = c.vercel;
  if (c.windowOrigin === undefined) delete globalAny.window;
  else globalAny.window = { location: { origin: c.windowOrigin } };
}

function restore() {
  console.error = savedConsoleError;
  for (const [key, value] of Object.entries(SAVED)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  if (savedWindow === undefined) delete globalAny.window;
  else globalAny.window = savedWindow;
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

try {
  console.log("production resolution");

  check("prod + NEXT_PUBLIC_SITE_URL=https://tirvea.com -> tirvea callback", () => {
    setup({ nodeEnv: "production", site: "https://tirvea.com" });
    assert.equal(authRedirectUrl("/auth/callback"), "https://tirvea.com/auth/callback");
    assert.equal(errors.length, 0);
  });

  check("prod + missing site url + VERCEL_URL host -> https:// normalized", () => {
    setup({ nodeEnv: "production", vercel: "my-app.vercel.app" });
    assert.equal(authRedirectUrl("/auth/callback"), "https://my-app.vercel.app/auth/callback");
    assert.equal(errors.length, 0);
  });

  check("prod + VERCEL_URL already carrying a scheme is normalized, not doubled", () => {
    setup({ nodeEnv: "production", vercel: "https://my-app.vercel.app/" });
    assert.equal(siteUrl(), "https://my-app.vercel.app");
  });

  check("prod + NEXT_PUBLIC_SITE_URL=http://localhost:3000 -> blocked + tirvea + error logged", () => {
    setup({ nodeEnv: "production", site: "http://localhost:3000" });
    assert.equal(authRedirectUrl("/auth/callback"), "https://tirvea.com/auth/callback");
    assert.ok(
      errors.some((e) => e.includes("localhost redirect blocked in production")),
      "expected '[auth:url] localhost redirect blocked in production' on console.error",
    );
  });

  check("prod + NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000 -> blocked too", () => {
    setup({ nodeEnv: "production", site: "http://127.0.0.1:3000" });
    assert.equal(siteUrl(), "https://tirvea.com");
    assert.ok(errors.some((e) => e.includes("localhost redirect blocked in production")));
  });

  check("prod + no envs at all -> tirvea fallback (+ misconfig logged)", () => {
    setup({ nodeEnv: "production" });
    assert.equal(authRedirectUrl("/auth/callback"), "https://tirvea.com/auth/callback");
    assert.ok(errors.some((e) => e.includes("no site URL configured in production")));
  });

  check("prod ignores browser origin even when nothing else is set", () => {
    setup({ nodeEnv: "production", windowOrigin: "http://localhost:3000" });
    assert.equal(siteUrl(), "https://tirvea.com");
  });

  check("prod ignores browser origin even when it looks legitimate", () => {
    setup({ nodeEnv: "production", windowOrigin: "https://evil.example.com" });
    assert.equal(siteUrl(), "https://tirvea.com");
  });

  check("no prod combination can produce localhost", () => {
    const sites = [undefined, "", "http://localhost:3000", "https://tirvea.com", "http://127.0.0.1"];
    const vercels = [undefined, "", "my-app.vercel.app", "localhost:3000"];
    const windows = [undefined, "http://localhost:3000"];
    for (const site of sites)
      for (const vercel of vercels)
        for (const windowOrigin of windows) {
          setup({ nodeEnv: "production", site, vercel, windowOrigin });
          const url = authRedirectUrl("/auth/callback");
          assert.ok(
            !/localhost|127\.0\.0\.1/i.test(url),
            `localhost leaked in prod: ${url} (site=${site}, vercel=${vercel}, window=${windowOrigin})`,
          );
        }
  });

  console.log("development resolution (unchanged)");

  check("dev + nothing set -> http://localhost:3000/auth/callback allowed", () => {
    setup({ nodeEnv: "development" });
    assert.equal(authRedirectUrl("/auth/callback"), "http://localhost:3000/auth/callback");
    assert.equal(errors.length, 0);
  });

  check("dev + browser origin is used (dev convenience preserved)", () => {
    setup({ nodeEnv: "development", windowOrigin: "http://localhost:4321" });
    assert.equal(siteUrl(), "http://localhost:4321");
  });

  check("dev + NEXT_PUBLIC_SITE_URL still wins over browser origin", () => {
    setup({ nodeEnv: "development", site: "https://staging.tirvea.com/", windowOrigin: "http://localhost:3000" });
    assert.equal(siteUrl(), "https://staging.tirvea.com");
  });

  check("authRedirectUrl adds the leading slash when missing", () => {
    setup({ nodeEnv: "development", site: "https://tirvea.com" });
    assert.equal(authRedirectUrl("auth/callback"), "https://tirvea.com/auth/callback");
  });

  console.log(`\n${passed} checks passed`);
} finally {
  restore();
}
