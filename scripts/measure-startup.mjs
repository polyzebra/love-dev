/**
 * Browser startup measurements (Phase 0J):
 *   node scripts/measure-startup.mjs [/route ...]
 *
 * Requires a production build (`npm run build`); starts `next start` on a
 * scratch port and drives real Chrome (playwright-core, system channel).
 * Per route, COLD load (cache disabled):
 *   - JS transferred (network bytes for scripts)
 *   - parse/execute proxy: total long-task time + count before idle
 *   - LCP (largest-contentful-paint)
 *   - INP proxy: event.duration of a synthetic click (event timing)
 * Plus a WARM client-side transition / -> /login: extra JS requests and
 * navigation time (route-transition cost).
 */
import { spawn } from "node:child_process";

const PORT = 3111;
const BASE = `http://127.0.0.1:${PORT}`;
const routes = process.argv.slice(2).filter((a) => a.startsWith("/"));
const ROUTES = routes.length > 0 ? routes : ["/", "/login", "/login/email", "/login/phone"];

const { chromium } = await import("playwright-core");

async function withServer(fn) {
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`${BASE}/api/health`)).status < 500) break;
      } catch {
        /* booting */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return await fn();
  } finally {
    server.kill("SIGTERM");
  }
}

async function measureCold(browser, route) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

  let jsBytes = 0;
  let jsCount = 0;
  page.on("response", async (res) => {
    if (res.request().resourceType() === "script") {
      jsCount += 1;
      try {
        jsBytes += (await res.body()).length;
      } catch {
        /* stream gone */
      }
    }
  });

  await page.addInitScript(() => {
    window.__metrics = { lcp: 0, longTasks: 0, longTaskMs: 0, inp: 0 };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__metrics.lcp = Math.max(window.__metrics.lcp, e.startTime);
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__metrics.longTasks += 1;
        window.__metrics.longTaskMs += e.duration;
      }
    }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__metrics.inp = Math.max(window.__metrics.inp, e.duration);
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 0 });
  });

  const started = Date.now();
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  const loadMs = Date.now() - started;
  // Synthetic interaction for the INP proxy.
  await page.mouse.click(10, 10);
  await page.waitForTimeout(600);
  const metrics = await page.evaluate(() => window.__metrics);
  await context.close();
  return {
    route,
    loadMs,
    jsKb: (jsBytes / 1024).toFixed(0),
    jsCount,
    lcpMs: metrics.lcp.toFixed(0),
    longTasks: metrics.longTasks,
    longTaskMs: metrics.longTaskMs.toFixed(0),
    inpMs: metrics.inp.toFixed(0),
  };
}

async function measureTransition(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let jsBytes = 0;
  let counting = false;
  page.on("response", async (res) => {
    if (counting && res.request().resourceType() === "script") {
      try {
        jsBytes += (await res.body()).length;
      } catch {
        /* stream gone */
      }
    }
  });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  counting = true;
  const started = Date.now();
  await page.click('a[href="/login"]');
  await page.waitForURL("**/login**", { timeout: 15_000 });
  await page.waitForLoadState("networkidle");
  const ms = Date.now() - started;
  await context.close();
  return { extraJsKb: (jsBytes / 1024).toFixed(0), ms };
}

await withServer(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  console.log(
    "route".padEnd(16) +
      "loadMs".padStart(8) +
      "jsKB".padStart(8) +
      "files".padStart(7) +
      "LCPms".padStart(8) +
      "long#".padStart(7) +
      "longMs".padStart(8) +
      "INPms".padStart(7),
  );
  for (const route of ROUTES) {
    const r = await measureCold(browser, route);
    console.log(
      r.route.padEnd(16) +
        String(r.loadMs).padStart(8) +
        String(r.jsKb).padStart(8) +
        String(r.jsCount).padStart(7) +
        String(r.lcpMs).padStart(8) +
        String(r.longTasks).padStart(7) +
        String(r.longTaskMs).padStart(8) +
        String(r.inpMs).padStart(7),
    );
  }
  try {
    const t = await measureTransition(browser);
    console.log(`\nwarm transition / -> /login: ${t.ms}ms, +${t.extraJsKb} KB route JS`);
  } catch (error) {
    console.log(`\nwarm transition measurement skipped: ${String(error).slice(0, 80)}`);
  }
  await browser.close();
});
