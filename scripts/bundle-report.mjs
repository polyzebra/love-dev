/**
 * Route-level client-bundle report + budget gate (Phase 0J).
 *
 *   node scripts/bundle-report.mjs                 # report default routes
 *   node scripts/bundle-report.mjs --check         # enforce budgets (CI)
 *   node scripts/bundle-report.mjs --grep motion   # which chunks contain X
 *   node scripts/bundle-report.mjs /route ...      # report specific routes
 *
 * Measures what a browser actually downloads: starts `next start` on a
 * scratch port (requires `npm run build` first), fetches each route's
 * HTML, collects every script/modulepreload chunk and sums raw + gzip
 * bytes from .next/static. Budgets guard the CRITICAL paths - marketing
 * home, login, onboarding entry - the screens a future Capacitor
 * WebView pays for at every cold start. (Authed routes measure their
 * logged-out shell - the login redirect target - which still tracks the
 * shared-chunk cost they inherit.)
 */
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const NEXT_DIR = path.join(process.cwd(), ".next");
const PORT = 3111;
const BASE = `http://127.0.0.1:${PORT}`;

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const GREP = args.includes("--grep") ? args[args.indexOf("--grep") + 1] : null;
const routeArgs = args.filter((a) => a.startsWith("/"));

const DEFAULT_ROUTES = ["/", "/login", "/login/email", "/login/phone", "/register", "/pricing"];

/**
 * Gzipped first-load JS budgets per route (KB). Phase 0J baseline
 * (2026-07-13, pre-optimization): /login 323.4, /login/phone 324.9,
 * / 272.2 - optimized to 261 / 292 / 273 by lazy-loading @supabase/*
 * and the libphonenumber metadata (which was also QUADRUPLICATED across
 * phone routes). Budgets sit ~8-10% above the optimized numbers so real
 * regressions fail while build noise passes.
 */
const BUDGETS_GZIP_KB = {
  "/": 300,
  "/login": 285,
  "/login/email": 290,
  "/login/phone": 320,
};

function fail(message) {
  console.error(`bundle-report: ${message}`);
  process.exit(2);
}

try {
  statSync(path.join(NEXT_DIR, "BUILD_ID"));
} catch {
  fail("no production build found - run `npm run build` first");
}

// --- grep mode: scan every chunk on disk, no server needed ---------------
if (GREP) {
  const dir = path.join(NEXT_DIR, "static", "chunks");
  const needle = GREP.toLowerCase();
  let hits = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".js")) continue;
    const full = path.join(dir, file);
    const content = readFileSync(full, "utf8");
    if (content.toLowerCase().includes(needle)) {
      hits += 1;
      const gz = gzipSync(readFileSync(full)).length;
      console.log(`${file}  ${(gz / 1024).toFixed(1)} KB gz`);
    }
  }
  if (hits === 0) console.log(`no client chunk contains "${GREP}"`);
  process.exit(0);
}

const sizeCache = new Map();
function chunkSize(urlPath) {
  if (sizeCache.has(urlPath)) return sizeCache.get(urlPath);
  const file = path.join(NEXT_DIR, urlPath.replace(/^\/_next\//, ""));
  let out = { raw: 0, gzip: 0 };
  try {
    const buf = readFileSync(file);
    out = { raw: buf.length, gzip: gzipSync(buf).length };
  } catch {
    // Not on disk (edge asset) - count as zero rather than guessing.
  }
  sizeCache.set(urlPath, out);
  return out;
}

function scriptsIn(html) {
  const found = new Set();
  for (const m of html.matchAll(/<script([^>]+)src="(\/_next\/[^"]+\.js)"/g)) {
    // Legacy-browser polyfills ship with noModule and are never fetched
    // by modern engines - excluding them keeps the numbers honest.
    if (/noModule|nomodule/.test(m[1]) || m[2].includes("polyfills")) continue;
    found.add(m[2]);
  }
  for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="(\/_next\/[^"]+\.js)"/g)) {
    found.add(m[1]);
  }
  return [...found];
}

async function measure(route) {
  const res = await fetch(`${BASE}${route}`, { redirect: "follow" });
  const html = await res.text();
  const chunks = scriptsIn(html);
  let raw = 0;
  let gzip = 0;
  for (const chunk of chunks) {
    const s = chunkSize(chunk);
    raw += s.raw;
    gzip += s.gzip;
  }
  return { route, status: res.status, chunks: chunks.length, raw, gzip };
}

async function withServer(fn) {
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  try {
    const deadline = Date.now() + 60_000;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${BASE}/api/health`);
        if (res.status < 500) {
          up = true;
          break;
        }
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!up) fail("next start did not come up on the scratch port");
    return await fn();
  } finally {
    server.kill("SIGTERM");
  }
}

const routes = routeArgs.length > 0 ? routeArgs : DEFAULT_ROUTES;

await withServer(async () => {
  const rows = [];
  for (const route of routes) rows.push(await measure(route));
  rows.sort((a, b) => b.gzip - a.gzip);

  const kb = (n) => (n / 1024).toFixed(1).padStart(9);
  console.log(
    "route".padEnd(28) +
      "status".padStart(7) +
      "chunks".padStart(8) +
      "raw KB".padStart(10) +
      "gzip KB".padStart(10),
  );
  for (const r of rows) {
    console.log(
      r.route.padEnd(28) +
        String(r.status).padStart(7) +
        String(r.chunks).padStart(8) +
        kb(r.raw) +
        kb(r.gzip),
    );
  }

  if (CHECK) {
    let failed = false;
    console.log("\nbudget check (gzip first-load JS):");
    for (const [route, limitKb] of Object.entries(BUDGETS_GZIP_KB)) {
      const row = rows.find((r) => r.route === route) ?? (await measure(route));
      const actual = row.gzip / 1024;
      const ok = actual <= limitKb;
      if (!ok) failed = true;
      console.log(
        `  ${ok ? "ok  " : "FAIL"}  ${route.padEnd(20)} ${actual.toFixed(1)} KB / ${limitKb} KB`,
      );
    }
    if (failed) {
      console.error("\nbundle budgets exceeded - investigate before shipping");
      process.exit(1);
    }
    console.log("\nall budgets respected");
  }
});
