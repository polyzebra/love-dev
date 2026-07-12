"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Check, Loader2 } from "lucide-react";
import { EASE_LUXE } from "@/lib/motion";
import { Button } from "@/components/ui/button";

/**
 * The confirm-page state machine. The page NEVER trusts the success
 * redirect: it polls GET /api/billing/checkout-status (which runs the
 * same server-side sync as the webhook) and only celebrates when the
 * DATABASE says the subscription is live. No fake success, ever.
 *
 *   CHECKING        polling every 2s (25s budget)
 *   ACTIVE          verified - success moment, then /discover after ~1.5s
 *   PENDING_SLOW    server still answers PENDING after the budget -
 *                   honest "taking longer" copy + Check again; NO redirect
 *   FAILED          payment did not complete
 *   CANCELED        checkout was abandoned/expired - nothing charged
 *   SESSION_INVALID missing/unknown/foreign session id
 *   UNREACHABLE     billing endpoint unavailable (503/network) - retry
 */
type ConfirmState =
  | { kind: "CHECKING" }
  | { kind: "ACTIVE"; plan: string }
  | { kind: "PENDING_SLOW" }
  | { kind: "FAILED" }
  | { kind: "CANCELED" }
  | { kind: "SESSION_INVALID"; message?: string }
  | { kind: "UNREACHABLE" };

const POLL_INTERVAL_MS = 2_000;
const INITIAL_BUDGET_MS = 25_000;
/** "Check again" gets a shorter follow-up budget before going slow again. */
const RECHECK_BUDGET_MS = 10_000;
const MAX_NETWORK_FAILURES = 3;

export function CheckoutConfirm({ sessionId }: { sessionId: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<ConfirmState>(
    sessionId ? { kind: "CHECKING" } : { kind: "SESSION_INVALID" },
  );
  const timer = useRef<number | null>(null);
  const redirectTimer = useRef<number | null>(null);
  const stopped = useRef(false);

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const startPolling = useCallback(
    (budgetMs: number) => {
      if (!sessionId) return;
      clearTimer();
      const startedAt = Date.now();
      let networkFailures = 0;

      const tick = async () => {
        if (stopped.current) return;
        let outcome:
          | { type: "state"; state: ConfirmState }
          | { type: "pending" }
          | { type: "network" };
        try {
          const res = await fetch(
            `/api/billing/checkout-status?session_id=${encodeURIComponent(sessionId)}`,
            { cache: "no-store" },
          );
          if (res.status === 401) {
            window.location.assign("/login?callbackUrl=%2Fsettings%2Fsubscription");
            return;
          }
          if (res.status === 404 || res.status === 422) {
            outcome = {
              type: "state",
              state: {
                kind: "SESSION_INVALID",
                message:
                  res.status === 404
                    ? "We couldn't match this checkout to your account."
                    : undefined,
              },
            };
          } else if (res.status === 503) {
            outcome = { type: "state", state: { kind: "UNREACHABLE" } };
          } else {
            const payload = (await res.json().catch(() => null)) as {
              data?: { state?: string; plan?: string };
            } | null;
            const s = payload?.data?.state;
            if (res.ok && s === "ACTIVE") {
              outcome = {
                type: "state",
                state: { kind: "ACTIVE", plan: payload?.data?.plan ?? "PLUS" },
              };
            } else if (res.ok && s === "PENDING") {
              outcome = { type: "pending" };
            } else if (res.ok && (s === "FAILED" || s === "CANCELED")) {
              outcome = { type: "state", state: { kind: s } };
            } else if (res.ok && s === "SESSION_INVALID") {
              outcome = { type: "state", state: { kind: "SESSION_INVALID" } };
            } else {
              // 429/5xx or malformed body - treat like a transient failure.
              outcome = { type: "network" };
            }
          }
        } catch {
          outcome = { type: "network" };
        }
        if (stopped.current) return;

        if (outcome.type === "state") {
          setState(outcome.state);
          if (outcome.state.kind === "ACTIVE") {
            // Refresh server components (nav badge, settings) THEN move on.
            router.refresh();
            redirectTimer.current = window.setTimeout(() => {
              router.push("/discover");
            }, 1_500);
          }
          return;
        }
        if (outcome.type === "network") {
          networkFailures += 1;
          if (networkFailures >= MAX_NETWORK_FAILURES) {
            setState({ kind: "UNREACHABLE" });
            return;
          }
        } else {
          networkFailures = 0;
        }
        if (Date.now() - startedAt >= budgetMs) {
          // Server still says PENDING - stay honest, never celebrate.
          setState({ kind: "PENDING_SLOW" });
          return;
        }
        timer.current = window.setTimeout(tick, POLL_INTERVAL_MS);
      };

      void tick();
    },
    [sessionId, router],
  );

  useEffect(() => {
    stopped.current = false;
    if (sessionId) startPolling(INITIAL_BUDGET_MS);
    return () => {
      stopped.current = true;
      clearTimer();
      if (redirectTimer.current !== null) window.clearTimeout(redirectTimer.current);
    };
  }, [sessionId, startPolling]);

  return (
    <div className="glass mx-auto max-w-md rounded-xl p-8 text-center">
      {state.kind === "CHECKING" && (
        <StateBlock
          icon={
            <span className="glass-chip flex size-14 items-center justify-center rounded-full">
              <Loader2 className="size-6 animate-spin text-foreground" aria-hidden="true" />
            </span>
          }
          title="Confirming your Tirvea membership"
          body="We've received your return from Stripe. We're securely confirming your subscription."
          live
        />
      )}

      {state.kind === "ACTIVE" && (
        <StateBlock
          icon={
            <motion.span
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.6, ease: EASE_LUXE }}
              className="flex size-14 items-center justify-center rounded-full bg-linear-160 from-brand-bright via-brand to-brand-active shadow-[0_8px_24px_color-mix(in_srgb,var(--primary)_35%,transparent)]"
            >
              <Check className="size-7 text-primary-foreground" aria-hidden="true" />
            </motion.span>
          }
          title={`Welcome to Tirvea ${state.plan === "GOLD" ? "Gold" : "Plus"}`}
          body="Your membership is active. Taking you to Discover..."
          live
        />
      )}

      {state.kind === "PENDING_SLOW" && (
        <StateBlock
          icon={<NeutralDot />}
          title="Almost there"
          body="Your payment was received. Activation is taking a little longer than usual."
          live
          actions={
            <>
              <Button
                className="min-h-11 rounded-full px-6"
                onClick={() => {
                  setState({ kind: "CHECKING" });
                  startPolling(RECHECK_BUDGET_MS);
                }}
              >
                Check again
              </Button>
              <Button variant="outline" className="min-h-11 rounded-full px-6" asChild>
                <Link href="/settings/subscription">Go to subscription settings</Link>
              </Button>
            </>
          }
        />
      )}

      {state.kind === "FAILED" && (
        <StateBlock
          icon={<NeutralDot />}
          title="Payment didn't complete"
          body="Stripe couldn't complete this payment, so nothing was activated. You can try again whenever you're ready."
          actions={
            <>
              <Button className="min-h-11 rounded-full px-6" asChild>
                <Link href="/pricing">Back to pricing</Link>
              </Button>
              <Button variant="outline" className="min-h-11 rounded-full px-6" asChild>
                <Link href="/settings/subscription">Subscription settings</Link>
              </Button>
            </>
          }
        />
      )}

      {state.kind === "CANCELED" && (
        <StateBlock
          icon={<NeutralDot />}
          title="Checkout cancelled"
          body="You left checkout before paying - nothing was charged. Upgrade whenever it feels right."
          actions={
            <>
              <Button className="min-h-11 rounded-full px-6" asChild>
                <Link href="/pricing">Back to pricing</Link>
              </Button>
              <Button variant="outline" className="min-h-11 rounded-full px-6" asChild>
                <Link href="/discover">Go to Discover</Link>
              </Button>
            </>
          }
        />
      )}

      {state.kind === "SESSION_INVALID" && (
        <StateBlock
          icon={<NeutralDot />}
          title="We can't confirm this checkout"
          body={
            state.message ??
            "This confirmation link is missing or no longer valid. If you completed a payment, your plan will appear in subscription settings shortly."
          }
          actions={
            <>
              <Button className="min-h-11 rounded-full px-6" asChild>
                <Link href="/settings/subscription">Subscription settings</Link>
              </Button>
              <Button variant="outline" className="min-h-11 rounded-full px-6" asChild>
                <Link href="/pricing">Back to pricing</Link>
              </Button>
            </>
          }
        />
      )}

      {state.kind === "UNREACHABLE" && (
        <StateBlock
          icon={<NeutralDot />}
          title="We can't confirm right now"
          body="Our payment provider can't be reached at the moment. If you paid, your membership will activate automatically - you can also check again."
          actions={
            <>
              <Button
                className="min-h-11 rounded-full px-6"
                onClick={() => {
                  setState({ kind: "CHECKING" });
                  startPolling(RECHECK_BUDGET_MS);
                }}
              >
                Check again
              </Button>
              <Button variant="outline" className="min-h-11 rounded-full px-6" asChild>
                <Link href="/settings/subscription">Go to subscription settings</Link>
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

function StateBlock({
  icon,
  title,
  body,
  actions,
  live,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  actions?: React.ReactNode;
  live?: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center gap-4"
      role={live ? "status" : undefined}
      aria-live={live ? "polite" : undefined}
    >
      {icon}
      <div className="space-y-2">
        <h2 className="font-display text-2xl font-medium tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      {actions ? (
        <div className="mt-2 flex w-full flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** Calm neutral state dot - non-success states stay brandless on purpose. */
function NeutralDot() {
  return (
    <span className="glass-chip flex size-14 items-center justify-center rounded-full">
      <span className="size-2.5 rounded-full bg-foreground/40" aria-hidden="true" />
    </span>
  );
}
