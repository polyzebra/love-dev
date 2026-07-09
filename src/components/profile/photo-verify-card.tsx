"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { BadgeCheck, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

const BENEFITS = [
  "Verified badge on your profile",
  "Higher trust with the people you meet",
  "More visibility in Discover",
];

/**
 * Post-onboarding nudge shown on the profile page while the account has
 * no photoVerifiedAt. Calls the start endpoint; when no provider is
 * configured the server answers 503 and we show a calm "coming soon"
 * toast - no fake progress. Selfie capture happens on the provider's
 * side only; Tirvea never stores biometric data.
 */
export function PhotoVerifyCard() {
  const [pending, startTransition] = useTransition();

  function start() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/verification/photo/start", { method: "POST" });
        if (res.status === 503) {
          toast("Photo verification is coming soon", {
            description: "We're getting this ready. You'll be able to verify from here soon.",
          });
          return;
        }
        if (!res.ok) {
          toast.error("Couldn't start verification. Please try again later.");
          return;
        }
        const body = (await res.json()) as { data?: { url?: string | null } };
        if (body.data?.url) {
          window.location.assign(body.data.url);
          return;
        }
        toast.success("Verification started. We'll update your badge once it completes.");
      } catch {
        toast.error("Network error. Check your connection and try again.");
      }
    });
  }

  return (
    <section className="glass rounded-3xl p-5">
      <div className="flex items-start gap-3.5">
        <span className="glass-chip flex size-11 shrink-0 items-center justify-center rounded-full">
          <BadgeCheck className="size-5 text-gold" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-medium tracking-tight">Get photo verified</p>
          <ul className="mt-2 space-y-1.5">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="size-3.5 shrink-0 text-success" aria-hidden="true" />
                {benefit}
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            className="mt-4 rounded-full px-5"
            disabled={pending}
            onClick={start}
          >
            Start verification
          </Button>
        </div>
      </div>
    </section>
  );
}
