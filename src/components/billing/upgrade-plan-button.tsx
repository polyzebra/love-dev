"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import { cn } from "@/lib/utils";

/**
 * THE payment-gated upgrade workflow for members with a live
 * subscription. Nothing is optimistic and nothing is charged silently:
 *
 *  1. tap -> POST /api/billing/change-plan/preview -> modal shows the
 *     EXACT Stripe proration ("Due today"), new price, unchanged renewal
 *  2. "Confirm and pay" (explicit) -> POST /api/billing/change-plan
 *  3. outcome drives the modal - the page never shows the new plan until
 *     the server confirms the money:
 *       PAID_AND_APPLIED / ZERO_DUE_APPLIED -> success, refresh
 *       REQUIRES_ACTION -> Stripe.js card authentication, then poll
 *       PENDING         -> poll GET /api/billing/change-plan/status <=30s
 *       PAYMENT_FAILED  -> "Your current plan is unchanged" + retry /
 *                          update payment method
 *
 * The clientSecret is used in-memory for Stripe.js only - never logged,
 * never persisted, never rendered.
 */

type PreviewData = {
  plan: string;
  planName: string;
  amountDueCents: number;
  currency: string;
  nextRecurringCents: number;
  renewsAt: string | null;
};

type Step =
  | "idle"
  | "previewing"
  | "preview"
  | "processing"
  | "authenticating"
  | "polling"
  | "failed";

const POLL_INTERVAL_MS = 2_000;
const POLL_BUDGET_MS = 30_000;

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Load Stripe.js on demand (card authentication only). */
async function loadStripeJs(): Promise<((pk: string) => StripeJs) | null> {
  const w = window as Window & { Stripe?: (pk: string) => StripeJs };
  if (w.Stripe) return w.Stripe;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("stripe.js failed to load"));
    document.head.appendChild(script);
  }).catch(() => null);
  return (window as Window & { Stripe?: (pk: string) => StripeJs }).Stripe ?? null;
}

type StripeJs = {
  confirmCardPayment(clientSecret: string): Promise<{
    error?: { message?: string };
    paymentIntent?: { status?: string };
  }>;
};

export function UpgradePlanButton({
  plan,
  label,
  className,
  errorClassName,
}: {
  plan: "PLUS" | "GOLD";
  /** Visible CTA text; defaults to "Upgrade to Tirvea Plus/Gold". */
  label?: string;
  className?: string;
  errorClassName?: string;
}) {
  const planName = plan === "PLUS" ? "Tirvea Plus" : "Tirvea Gold";
  const ctaLabel = label ?? `Upgrade to ${planName}`;
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  // In-memory only - never logged, never rendered.
  const clientSecretRef = useRef<string | null>(null);

  const busy = step !== "idle" && step !== "preview" && step !== "failed";
  const modalOpen = step !== "idle" && step !== "previewing";

  function reset() {
    clientSecretRef.current = null;
    setPreview(null);
    setModalError(null);
    setStep("idle");
  }

  async function fetchJson(input: string, init?: RequestInit) {
    const res = await fetch(input, init);
    if (res.status === 401) {
      const here = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/login?callbackUrl=${encodeURIComponent(here)}`);
      return null;
    }
    const payload = (await res.json().catch(() => null)) as {
      data?: Record<string, unknown>;
      error?: { message?: string };
    } | null;
    return { res, payload };
  }

  // Step 1 - preview: nothing is charged, the modal shows exact amounts.
  async function openPreview() {
    if (step !== "idle") return;
    setError(null);
    setStep("previewing");
    try {
      const out = await fetchJson("/api/billing/change-plan/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!out) return; // navigating to login
      if (out.res.ok && out.payload?.data) {
        setPreview(out.payload.data as PreviewData);
        setStep("preview");
        return;
      }
      setStep("idle");
      setError(
        out.payload?.error?.message ??
          "We couldn't prepare the upgrade. Nothing was charged - please try again.",
      );
      router.refresh();
    } catch {
      setStep("idle");
      setError("We couldn't reach Tirvea. Check your connection and try again.");
    }
  }

  function succeed() {
    toast(`Welcome to ${planName} - your upgrade is active.`);
    reset();
    router.refresh();
  }

  // Poll the fresh-Stripe status endpoint; never grants anything locally.
  async function pollStatus(): Promise<void> {
    setStep("polling");
    const deadline = Date.now() + POLL_BUDGET_MS;
    while (Date.now() < deadline) {
      try {
        const out = await fetchJson("/api/billing/change-plan/status");
        if (!out) return;
        const state = out.payload?.data?.state;
        if (state === "ACTIVE_GOLD") return succeed();
        if (state === "PAYMENT_FAILED") {
          setModalError(null);
          setStep("failed");
          return;
        }
        if (state === "REQUIRES_ACTION") {
          const secret = out.payload?.data?.clientSecret;
          if (typeof secret === "string") clientSecretRef.current = secret;
          return authenticate();
        }
        // STILL_PLUS while a payment settles reads as pending - keep polling.
      } catch {
        // transient - keep polling until the budget runs out
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    setModalError(
      "We're still confirming your payment with Stripe. Your current plan stays active - check back in a moment.",
    );
    setStep("failed");
  }

  // REQUIRES_ACTION - hand the real authentication to Stripe.js.
  async function authenticate(): Promise<void> {
    const secret = clientSecretRef.current;
    if (!secret) return pollStatus();
    setStep("authenticating");
    const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!pk) {
      setModalError(
        "Your bank asked for authentication, but it can't be opened here. Complete the payment from Manage billing - your current plan stays active until then.",
      );
      setStep("failed");
      return;
    }
    try {
      const stripeFactory = await loadStripeJs();
      if (!stripeFactory) throw new Error("stripe.js unavailable");
      const stripe = stripeFactory(pk);
      await stripe.confirmCardPayment(secret); // outcome verified server-side
    } catch {
      // fall through - the status endpoint is the truth either way
    }
    clientSecretRef.current = null;
    await pollStatus();
  }

  // Step 2/3 - the ONLY place the update endpoint is called, strictly
  // after explicit confirmation. Double-taps are blocked by `step` and
  // deduplicated server-side by the stable Stripe idempotency key.
  async function confirmAndPay() {
    if (step !== "preview") return;
    setModalError(null);
    setStep("processing");
    try {
      const out = await fetchJson("/api/billing/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!out) return;
      const outcome = out.res.ok ? out.payload?.data?.outcome : null;
      switch (outcome) {
        case "PAID_AND_APPLIED":
        case "ZERO_DUE_APPLIED":
          return succeed();
        case "REQUIRES_ACTION": {
          const secret = out.payload?.data?.clientSecret;
          if (typeof secret === "string") clientSecretRef.current = secret;
          return authenticate();
        }
        case "PENDING":
          return pollStatus();
        case "PAYMENT_FAILED":
          setStep("failed");
          return;
        default:
          setModalError(
            out.payload?.error?.message ??
              "We couldn't complete the upgrade. Your current plan is unchanged.",
          );
          setStep("failed");
          router.refresh();
      }
    } catch {
      setModalError("We couldn't reach Tirvea. Your current plan is unchanged.");
      setStep("failed");
    }
  }

  const dueToday = preview ? money(preview.amountDueCents, preview.currency) : null;

  return (
    <div className="inline-flex max-w-full flex-col items-center gap-3">
      <Button
        type="button"
        onClick={openPreview}
        disabled={step !== "idle"}
        aria-busy={step === "previewing"}
        className={cn("min-h-11 max-w-full", className)}
      >
        <span className="grid max-w-full place-items-center">
          <span
            aria-hidden={step === "previewing"}
            className={cn(
              "col-start-1 row-start-1 inline-flex items-center gap-2 truncate",
              step === "previewing" && "invisible",
            )}
          >
            {ctaLabel}
          </span>
          <span
            aria-hidden={step !== "previewing"}
            className={cn(
              "col-start-1 row-start-1 inline-flex items-center gap-2 truncate",
              step !== "previewing" && "invisible",
            )}
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Preparing your upgrade...
          </span>
        </span>
      </Button>
      <p
        role="status"
        aria-live="polite"
        className={cn(
          "max-w-xs text-sm text-muted-foreground",
          !error && "sr-only",
          errorClassName,
        )}
      >
        {error}
      </p>

      <Dialog
        open={modalOpen}
        onOpenChange={(open) => {
          if (!open && !busy) reset(); // no dismissal mid-payment
        }}
      >
        <DialogContent showCloseButton={!busy} className="max-w-md">
          {step === "failed" ? (
            <>
              <DialogHeader>
                <DialogTitle>We couldn&apos;t complete the upgrade</DialogTitle>
                <DialogDescription>
                  {modalError ??
                    "The payment didn't go through. Your current plan is unchanged and nothing else was charged."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex-col gap-2 sm:flex-col">
                <Button type="button" className="w-full rounded-full" onClick={openPreviewAgain}>
                  Try again
                </Button>
                <ManageBillingButton
                  label="Update payment method"
                  flow="payment_method_update"
                  className="w-full"
                />
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full rounded-full"
                  onClick={reset}
                >
                  Not now
                </Button>
              </DialogFooter>
            </>
          ) : step === "preview" && preview ? (
            <>
              <DialogHeader>
                <DialogTitle>Upgrade to {preview.planName}</DialogTitle>
                <DialogDescription>
                  You&apos;ll pay only the prorated difference for the rest of your current
                  billing period. Your renewal date stays the same.
                </DialogDescription>
              </DialogHeader>
              <dl className="space-y-3 text-sm">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">New monthly price</dt>
                  <dd className="font-medium tabular-nums">
                    {money(preview.nextRecurringCents, preview.currency)}/month
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">Due today</dt>
                  <dd className="font-display text-2xl font-medium tabular-nums">{dueToday}</dd>
                </div>
                {preview.renewsAt && (
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-muted-foreground">Next renewal</dt>
                    <dd className="font-medium">
                      {formatDate(preview.renewsAt)} ·{" "}
                      {money(preview.nextRecurringCents, preview.currency)}
                    </dd>
                  </div>
                )}
              </dl>
              <DialogFooter className="flex-col gap-2 sm:flex-col">
                <Button type="button" className="w-full rounded-full" onClick={confirmAndPay}>
                  Confirm and pay {dueToday}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full rounded-full"
                  onClick={reset}
                >
                  Not now
                </Button>
              </DialogFooter>
              <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                Charged securely by Stripe - never before you confirm
              </p>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  {step === "authenticating"
                    ? "Confirm with your bank"
                    : step === "polling"
                      ? "Confirming your payment..."
                      : "Processing secure payment..."}
                </DialogTitle>
                <DialogDescription>
                  {step === "authenticating"
                    ? "Your bank may ask you to approve this payment. Don't close this window."
                    : `Your ${planName} upgrade applies the moment Stripe confirms the payment - nothing changes before that.`}
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center justify-center py-6">
                <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );

  // "Try again" restarts from a FRESH preview (amounts may have moved).
  function openPreviewAgain() {
    reset();
    void openPreview();
  }
}
