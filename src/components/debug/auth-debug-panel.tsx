"use client";

/**
 * TEMPORARY production-safe auth-transition diagnostics.
 *
 * Enabled ONLY by visiting any page with ?authdebug=1 (persists for the
 * tab via sessionStorage so it survives the navigation being debugged).
 * Renders a live badge (bottom-left), records every lifecycle event of
 * the [data-debug] auth nodes plus paint/navigation/longtask/resource
 * timings and a 5s requestAnimationFrame recorder after the Sign-in tap
 * into window.__TIRVEA_AUTH_DEBUG__ (last 200 events), and offers a
 * "Copy debug log" button.
 *
 * PRIVACY: logs contain only pathnames (never query strings), element
 * geometry/styles, timings, UA and build id - no cookies, tokens,
 * emails, phone numbers or session contents.
 */

import { useEffect, useState } from "react";

type DebugEvent = { t: number; e: string; [k: string]: unknown };

declare global {
  interface Window {
    __TIRVEA_AUTH_DEBUG__?: DebugEvent[];
  }
  interface Navigator {
    standalone?: boolean;
  }
}

let prevPath = "(entry)";

const NODES = [
  "auth-layout",
  "auth-card",
  "auth-fallback",
  "login-page",
  "login-form",
  "auth-motion-shell",
] as const;

function now() {
  return Math.round(performance.now() * 10) / 10;
}

function q(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-debug="${name}"]`);
}

function debugName(el: unknown): string | null {
  if (!(el instanceof HTMLElement)) return null;
  const own = el.getAttribute?.("data-debug");
  if (own) return own;
  const up = el.closest?.("[data-debug]");
  return up?.getAttribute("data-debug") ?? null;
}

function styleOf(el: HTMLElement | null) {
  if (!el) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    w: Math.round(r.width),
    h: Math.round(r.height),
    opacity: cs.opacity,
    visibility: cs.visibility,
    display: cs.display,
    transform: cs.transform === "none" ? undefined : cs.transform.slice(0, 40),
  };
}

function snapshot(prevPath: string) {
  const card = q("auth-card");
  const first = (card?.firstElementChild as HTMLElement | null) ?? null;
  return {
    path: location.pathname,
    from: prevPath,
    vis: document.visibilityState,
    online: navigator.onLine,
    standalone:
      window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true,
    nodes: NODES.filter((n) => q(n)),
    cardChildren: card?.childElementCount ?? null,
    card: styleOf(card),
    firstChild: first
      ? { name: debugName(first) ?? first.tagName.toLowerCase(), ...styleOf(first) }
      : null,
    fallback: Boolean(q("auth-fallback")),
    loginForm: Boolean(q("login-form")),
  };
}

export function AuthDebugPanel({ buildId }: { buildId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [, force] = useState(0);
  const [copied, setCopied] = useState<"idle" | "ok" | "manual">("idle");
  const [manualText, setManualText] = useState("");

  // Enable via ?authdebug=1; persist for the tab so the debugged
  // navigation (which drops the query) keeps the panel alive.
  useEffect(() => {
    const on =
      new URLSearchParams(location.search).get("authdebug") === "1" ||
      sessionStorage.getItem("authdebug") === "1";
    if (new URLSearchParams(location.search).get("authdebug") === "1") {
      sessionStorage.setItem("authdebug", "1");
    }
    if (!on) return;
    // Next frame, never synchronously in the effect (lint: cascading renders).
    const raf = requestAnimationFrame(() => setEnabled(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const log = (e: string, data: Record<string, unknown> = {}) => {
      const buf = (window.__TIRVEA_AUTH_DEBUG__ ??= []);
      buf.push({ t: now(), e, ...data });
      if (buf.length > 200) buf.splice(0, buf.length - 200);
    };
    log("debug:start", {
      build: buildId,
      ua: navigator.userAgent,
      hydratedAt: now(),
      ...snapshot(prevPath),
    });

    // ---- route transitions (history patch + popstate) ----------------
    const history_ = window.history;
    const origPush = history_.pushState.bind(history_);
    const origReplace = history_.replaceState.bind(history_);
    const onRoute = (kind: string) => {
      log(`route:${kind}`, { from: prevPath, to: location.pathname });
      prevPath = location.pathname;
    };
    history_.pushState = (...a) => {
      const r = origPush(...(a as Parameters<typeof origPush>));
      onRoute("push");
      return r;
    };
    history_.replaceState = (...a) => {
      const r = origReplace(...(a as Parameters<typeof origReplace>));
      onRoute("replace");
      return r;
    };
    const onPop = () => onRoute("pop");
    window.addEventListener("popstate", onPop);

    // ---- Sign-in CTA capture-phase listeners + frame recorder --------
    let rafStop = 0;
    const startFrameRecorder = () => {
      rafStop = performance.now() + 5000;
      let lastSig = "";
      const tick = () => {
        if (performance.now() > rafStop) return;
        const s = snapshot(prevPath);
        const sig = JSON.stringify(s);
        if (sig !== lastSig) {
          lastSig = sig;
          log("frame", s as unknown as Record<string, unknown>);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    const isSignInLink = (t: EventTarget | null) =>
      t instanceof Element ? t.closest('a[href^="/login"]') : null;
    const onPointerDown = (ev: PointerEvent) => {
      const a = isSignInLink(ev.target);
      if (a) log("cta:pointerdown", { href: a.getAttribute("href") });
    };
    const onClickCapture = (ev: MouseEvent) => {
      const a = isSignInLink(ev.target);
      if (!a) return;
      log("cta:click", {
        href: a.getAttribute("href"),
        defaultPrevented: ev.defaultPrevented,
      });
      startFrameRecorder();
      // After dispatch completes, defaultPrevented reveals whether the
      // Next.js router intercepted the navigation (soft nav) or the
      // browser will do a full document load.
      setTimeout(
        () =>
          log("cta:post-dispatch", {
            defaultPrevented: ev.defaultPrevented,
            interceptedByRouter: ev.defaultPrevented,
            path: location.pathname,
          }),
        0,
      );
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClickCapture, true);

    // ---- MutationObserver on the diagnostic nodes ---------------------
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "childList") {
          for (const n of m.addedNodes) {
            const name = debugName(n);
            if (name)
              log("dom:insert", {
                node: name,
                cardChildren: q("auth-card")?.childElementCount ?? null,
              });
          }
          for (const n of m.removedNodes) {
            const name = debugName(n);
            if (name)
              log("dom:remove", {
                node: name,
                cardChildren: q("auth-card")?.childElementCount ?? null,
              });
          }
          const tname = debugName(m.target);
          if (tname === "auth-card") {
            log("dom:card-children", {
              cardChildren: (m.target as HTMLElement).childElementCount,
            });
          }
        } else if (m.type === "attributes") {
          const name = debugName(m.target);
          if (name) {
            const el = m.target as HTMLElement;
            log("dom:attr", {
              node: name,
              attr: m.attributeName,
              opacity: getComputedStyle(el).opacity,
              hidden: el.hidden || el.getAttribute("aria-hidden") === "true",
            });
          }
        }
      }
    });
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden"],
    });

    // ---- PerformanceObserver ------------------------------------------
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === "resource") {
          const url = entry.name.split("?")[0];
          if (!url.includes("/login")) continue;
          log("perf:resource", {
            url: url.replace(location.origin, ""),
            dur: Math.round(entry.duration),
            start: Math.round(entry.startTime),
          });
        } else {
          log(`perf:${entry.entryType}`, {
            name: entry.name,
            start: Math.round(entry.startTime),
            dur: Math.round(entry.duration),
          });
        }
      }
    });
    for (const type of [
      "navigation",
      "paint",
      "largest-contentful-paint",
      "longtask",
      "resource",
    ]) {
      try {
        po.observe({ type, buffered: true } as PerformanceObserverInit);
      } catch {
        // entry type unsupported on this engine - fine
      }
    }

    const badgeTimer = setInterval(() => force((n) => n + 1), 300);
    return () => {
      clearInterval(badgeTimer);
      mo.disconnect();
      po.disconnect();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("popstate", onPop);
      history_.pushState = origPush;
      history_.replaceState = origReplace;
      rafStop = 0;
    };
  }, [enabled, buildId]);

  if (!enabled) return null;

  const s = typeof document !== "undefined" ? snapshot(prevPath) : null;

  async function copyLog() {
    const payload = JSON.stringify(
      {
        build: buildId,
        ua: navigator.userAgent,
        copiedAt: new Date().toISOString(),
        events: window.__TIRVEA_AUTH_DEBUG__ ?? [],
      },
      null,
      1,
    );
    try {
      await navigator.clipboard.writeText(payload);
      setCopied("ok");
    } catch {
      setManualText(payload);
      setCopied("manual");
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        left: 8,
        bottom: 8,
        zIndex: 99999,
        maxWidth: "min(88vw, 340px)",
        fontFamily: "ui-monospace, monospace",
        fontSize: 10,
        lineHeight: 1.35,
        background: "rgba(0,0,0,0.82)",
        color: "#9fefb0",
        borderRadius: 8,
        padding: "8px 10px",
        pointerEvents: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
    >
      {s && (
        <>
          {`build ${buildId.slice(0, 7)} | ${s.path} (from ${s.from})\n`}
          {`t=${now()} vis=${s.vis} online=${s.online ? 1 : 0} pwa=${s.standalone ? 1 : 0} hydrated=1\n`}
          {`nodes=[${s.nodes.join(",")}]\n`}
          {`card=${s.card ? `${s.card.w}x${s.card.h} op:${s.card.opacity} ${s.card.visibility}/${s.card.display}` : "none"} children=${s.cardChildren ?? "-"}\n`}
          {`first=${s.firstChild ? `${s.firstChild.name} ${s.firstChild.w}x${s.firstChild.h} op:${s.firstChild.opacity}` : "none"}\n`}
          {`fallback=${s.fallback ? "yes" : "no"} loginForm=${s.loginForm ? "yes" : "no"} events=${window.__TIRVEA_AUTH_DEBUG__?.length ?? 0}`}
        </>
      )}
      <button
        type="button"
        onClick={copyLog}
        style={{
          display: "block",
          marginTop: 6,
          padding: "6px 10px",
          borderRadius: 6,
          border: "1px solid #9fefb0",
          background: "transparent",
          color: "#9fefb0",
          fontSize: 11,
        }}
      >
        {copied === "ok" ? "Copied ✓" : "Copy debug log"}
      </button>
      {copied === "manual" && (
        <textarea
          readOnly
          value={manualText}
          style={{ width: "100%", height: 90, marginTop: 6, fontSize: 9 }}
          onFocus={(ev) => ev.currentTarget.select()}
        />
      )}
    </div>
  );
}
