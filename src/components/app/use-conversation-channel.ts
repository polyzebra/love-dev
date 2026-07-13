"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Realtime subscription for one conversation (Phase 0G).
 *
 * Transport rules:
 *  - PRIVATE broadcast channel `conversation:<id>` - joins are authorized
 *    by the RLS policy (participants only); the browser never subscribes
 *    to database changes
 *  - events DELIVER state, they never define it: every payload is merged
 *    through the thread-store dedupe/ordering rules and the DB remains
 *    the source of truth
 *  - reconnect: exponential backoff (1s -> 30s cap), plus an immediate
 *    attempt when the tab regains visibility or the network comes back
 *  - missed-message recovery: `onRecover` fires on EVERY successful
 *    (re)subscribe and on visibility regain - the caller fetches the
 *    authorized GET and merges; while the channel is unhealthy a slow
 *    15s recovery loop runs (temporary by construction: it stops the
 *    moment the channel is healthy again - not permanent polling)
 *
 * Metrics (reported through the caller): delivery latency per event
 * (now - payload.serverTs), reconnect time, duplicate and recovered
 * counts are accumulated by the caller's merge results.
 */

export type ChannelHealth = "connecting" | "healthy" | "degraded";

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;
const DEGRADED_RECOVERY_INTERVAL_MS = 15_000;

export function useConversationChannel(opts: {
  conversationId: string;
  onBroadcast: (event: string, payload: Record<string, unknown>) => void;
  /** Fetch-and-merge callback; reason distinguishes catch-up kinds. */
  onRecover: (reason: "subscribe" | "visibility" | "degraded") => void;
  onHealthChange?: (health: ChannelHealth) => void;
  /** Called once per successful (re)subscribe with the time it took. */
  onReconnectMeasured?: (ms: number) => void;
}) {
  const { conversationId } = opts;
  // Keep the latest callbacks without re-subscribing on every render
  // (written in an effect - refs are never touched during render).
  const callbacks = useRef(opts);
  useEffect(() => {
    callbacks.current = opts;
  });

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let disposed = false;
    let attempt = 0;
    let attemptStartedAt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let degradedTimer: ReturnType<typeof setInterval> | null = null;

    const setHealth = (health: ChannelHealth) => {
      callbacks.current.onHealthChange?.(health);
      if (health === "degraded" && !degradedTimer) {
        // Temporary by construction: cleared on the next healthy subscribe.
        degradedTimer = setInterval(
          () => callbacks.current.onRecover("degraded"),
          DEGRADED_RECOVERY_INTERVAL_MS,
        );
      }
      if (health === "healthy" && degradedTimer) {
        clearInterval(degradedTimer);
        degradedTimer = null;
      }
    };

    const teardownChannel = () => {
      if (channel) {
        const doomed = channel;
        void supabaseBrowser().then((s) => s.removeChannel(doomed));
        channel = null;
      }
    };

    const scheduleRetry = () => {
      if (disposed || retryTimer) return;
      const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void subscribe();
      }, delay);
    };

    const subscribe = async () => {
      if (disposed) return;
      const supabase = await supabaseBrowser();
      if (disposed) return;
      teardownChannel();
      setHealth(attempt === 0 ? "connecting" : "degraded");
      attemptStartedAt = Date.now();

      // Private-channel joins are authorized with the user's JWT; the
      // RLS policy decides membership. No token -> the join is refused.
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) {
        await supabase.realtime.setAuth(data.session.access_token);
      }
      if (disposed) return;

      channel = supabase
        .channel(`conversation:${conversationId}`, { config: { private: true } })
        .on("broadcast", { event: "message:new" }, (event) =>
          callbacks.current.onBroadcast("message:new", event.payload ?? {}),
        )
        .on("broadcast", { event: "receipt" }, (event) =>
          callbacks.current.onBroadcast("receipt", event.payload ?? {}),
        )
        .subscribe((status) => {
          if (disposed) return;
          if (status === "SUBSCRIBED") {
            callbacks.current.onReconnectMeasured?.(Date.now() - attemptStartedAt);
            attempt = 0;
            setHealth("healthy");
            // Missed-message recovery: everything since the last known
            // row is fetched through the authorized GET and merged.
            callbacks.current.onRecover("subscribe");
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setHealth("degraded");
            scheduleRetry();
          }
        });
    };

    const onVisibleOrOnline = () => {
      if (document.visibilityState !== "visible") return;
      callbacks.current.onRecover("visibility");
      const state = channel?.state;
      if (state !== "joined" && state !== "joining" && !retryTimer) {
        attempt = 0;
        void subscribe();
      }
    };

    void subscribe();
    document.addEventListener("visibilitychange", onVisibleOrOnline);
    window.addEventListener("online", onVisibleOrOnline);

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (degradedTimer) clearInterval(degradedTimer);
      document.removeEventListener("visibilitychange", onVisibleOrOnline);
      window.removeEventListener("online", onVisibleOrOnline);
      teardownChannel();
    };
  }, [conversationId]);
}
