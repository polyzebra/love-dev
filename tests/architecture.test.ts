/**
 * Architecture boundary tests (Phase 0K):
 *   npx tsx tests/architecture.test.ts
 *
 * Machine-checks the dependency direction
 *   UI / route adapters -> application services -> domain rules
 *     -> infrastructure INTERFACES
 * so platform dependencies can never silently creep back into the
 * domain/application layer. Pure source scan - no DB, no env.
 *
 * Layer map (see docs/ARCHITECTURE-BOUNDARIES.md):
 *  - DOMAIN/APPLICATION: src/lib/services, src/lib/validators,
 *    src/lib/api-contract, src/lib/chat, src/lib/auth/rate-limit.ts,
 *    src/lib/auth/transport.ts, src/lib/rate-limit.ts, src/lib/rbac.ts,
 *    src/lib/audit.ts - framework-free by construction.
 *  - ADAPTERS (may touch platform): src/lib/api.ts (HTTP), src/lib/auth.ts
 *    (session), src/lib/defer.ts (Next after), src/lib/storage.ts
 *    (Supabase storage), src/lib/supabase/*, everything under src/app
 *    and src/components.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const SRC = path.join(process.cwd(), "src");

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = path.join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** Strip comments so documentation prose never trips the token scan. */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const DOMAIN_DIRS = [
  path.join(SRC, "lib", "services"),
  path.join(SRC, "lib", "validators"),
  path.join(SRC, "lib", "api-contract"),
  path.join(SRC, "lib", "chat"),
];
const DOMAIN_FILES = [
  ...DOMAIN_DIRS.flatMap(filesUnder),
  path.join(SRC, "lib", "rate-limit.ts"),
  path.join(SRC, "lib", "rbac.ts"),
  path.join(SRC, "lib", "audit.ts"),
  path.join(SRC, "lib", "auth", "rate-limit.ts"),
  path.join(SRC, "lib", "auth", "transport.ts"),
];

const rel = (f: string) => path.relative(process.cwd(), f);

console.log("dependency direction (domain/application layer)");

check("no Next.js imports in the domain/application layer", () => {
  const offenders = DOMAIN_FILES.filter((f) => /from\s+["']next(\/|["'])/.test(codeOf(f))).map(rel);
  assert.deepEqual(offenders, [], "services must use seams (lib/defer.ts), never Next directly");
});

check("no React/DOM/client directives in the domain/application layer", () => {
  const offenders = DOMAIN_FILES.filter((f) => {
    const code = codeOf(f);
    return (
      /from\s+["']react["']/.test(code) ||
      /["']use client["']/.test(code) ||
      /(?<![\w.$])(window|document|localStorage|sessionStorage|navigator)\s*[.[]/.test(code)
    );
  }).map(rel);
  assert.deepEqual(offenders, []);
});

check("no cookie/request-bound Supabase helpers in the domain/application layer", () => {
  const offenders = DOMAIN_FILES.filter((f) =>
    /supabase\/server|next\/headers|@supabase\/ssr/.test(codeOf(f)),
  ).map(rel);
  assert.deepEqual(offenders, [], "storage/session access goes through lib/storage.ts / auth()");
});

check("services never import the HTTP route layer (lib/api.ts)", () => {
  const offenders = DOMAIN_FILES.filter((f) => /from\s+["']@\/lib\/api["']/.test(codeOf(f))).map(
    rel,
  );
  assert.deepEqual(offenders, [], "the arrow points routes -> services, never back");
});

check("payment SDK UI concerns stay out of services (no @stripe/*-js)", () => {
  const offenders = DOMAIN_FILES.filter((f) =>
    /@stripe\/(stripe-js|react-stripe-js)/.test(codeOf(f)),
  ).map(rel);
  assert.deepEqual(offenders, []);
});

console.log("infrastructure interfaces exist and stay in place");

const read = (...parts: string[]) => readFileSync(path.join(SRC, ...parts), "utf8");

check("authentication identity: pure decision matrix + canonical principal", () => {
  const transport = read("lib", "auth", "transport.ts");
  assert.ok(transport.includes("export function decideIdentity"));
  assert.ok(transport.includes("export function parseAuthorizationHeader"));
});

check("notifications: transport adapter interface + test seam", () => {
  const transports = read("lib", "services", "notification-transports.ts");
  assert.ok(transports.includes("export interface NotificationTransportAdapter"));
  assert.ok(transports.includes("export function setTransportAdapter"));
  assert.ok(transports.includes("export function fakeAdapter"));
});

check("billing provider: StripeClient interface + injection seam", () => {
  const stripe = read("lib", "stripe.ts");
  assert.ok(stripe.includes("export interface StripeClient"));
  assert.ok(/set\w*Client/.test(stripe), "test/client injection seam present");
});

check("moderation provider: ModerationProvider interface + provider registry", () => {
  const moderation = read("lib", "services", "moderation.ts");
  assert.ok(moderation.includes("export interface ModerationProvider"));
  assert.ok(moderation.includes("export function pickProvider"));
});

check("storage: one adapter module owns object I/O", () => {
  const storage = read("lib", "storage.ts");
  assert.ok(storage.includes("export async function storageClient"));
  for (const service of ["photos.ts", "media.ts", "moderation.ts"]) {
    assert.ok(
      read("lib", "services", service).includes("@/lib/storage"),
      `${service} goes through the storage adapter`,
    );
  }
});

check("realtime delivery: framework-free broadcast seam", () => {
  const realtime = read("lib", "services", "realtime.ts");
  assert.ok(realtime.includes("export async function broadcastToConversation"));
  assert.ok(!/from\s+["']next/.test(realtime), "fetch-only, no framework");
});

check("clock/time: outbox and limiter accept injected time", () => {
  assert.ok(read("lib", "services", "notify.ts").includes("now: Date = new Date()"));
  assert.ok(read("lib", "rate-limit.ts").includes("createRateLimiter"));
});

check("rate limiting: store interface + injectable limiter factory", () => {
  const rl = read("lib", "rate-limit.ts");
  assert.ok(rl.includes("export interface RateLimitStore"));
  assert.ok(rl.includes("export function createRateLimiter"));
});

console.log("future package boundaries (Phase 0L - extraction readiness)");

/** Import specifiers of one file (comment-stripped). */
function importsOf(file: string): string[] {
  return [...codeOf(file).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
}

/** Assert every import of every file under dir matches one allowed pattern. */
function pinBoundary(name: string, dir: string, allowed: RegExp[], except: string[] = []) {
  const offenders: string[] = [];
  for (const file of filesUnder(dir)) {
    if (except.some((e) => file.endsWith(e))) continue;
    for (const spec of importsOf(file)) {
      if (!allowed.some((re) => re.test(spec))) offenders.push(`${rel(file)} -> ${spec}`);
    }
  }
  assert.deepEqual(offenders, [], `${name} must only use portable imports`);
}

check("packages/api-contract: zod + relative imports only", () => {
  pinBoundary("api-contract", path.join(SRC, "lib", "api-contract"), [/^zod$/, /^\.\.?\//]);
});

check("packages/api-client: zod + relative + sibling contract only", () => {
  // browser.ts is the WEB APP's singleton glue - it stays behind in
  // apps/web when the client extracts, so it is exempt here.
  pinBoundary(
    "api-client",
    path.join(SRC, "lib", "api-client"),
    [/^zod$/, /^\.\.?\//],
    ["browser.ts"],
  );
});

check("packages/core (chat/thread-store, auth/transport): dependency-free", () => {
  pinBoundary("chat", path.join(SRC, "lib", "chat"), [/^\.\.?\//]);
  assert.deepEqual(importsOf(path.join(SRC, "lib", "auth", "transport.ts")), []);
});

check("packages/validation: zod + the documented core edges, nothing app-layer", () => {
  // The known extraction edges (MONOREPO-PLAN.md): product config,
  // taxonomy, constants and the generated Prisma enums move to (or are
  // re-exported by) packages/core. Anything OUTSIDE this list creeping
  // in would silently deepen the coupling - fail loudly instead.
  pinBoundary("validators", path.join(SRC, "lib", "validators"), [
    /^zod$/,
    /^\.\.?\//,
    /^@\/config\/prompts$/,
    /^@\/lib\/discovery\/taxonomy$/,
    /^@\/lib\/constants$/,
    /^@\/generated\/prisma\/enums$/,
  ]);
});

console.log(`\n${passed} checks passed`);
