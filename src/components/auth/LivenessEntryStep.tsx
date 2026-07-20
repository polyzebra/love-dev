"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, IdCard, ShieldCheck, Sparkles } from "lucide-react";
import { AuthCard } from "@/components/auth/AuthCard";
import { LivenessCapture } from "@/components/profile/liveness-capture";
import { LEGAL_ROUTES } from "@/lib/legal/routes";

/**
 * L8.1.1 The /auth/liveness ENTRY step (Phase C/D). Final registration rung:
 * one-time AWS Face Liveness before the user may meet other members. Pure
 * presentation + a thin wrapper around the existing, hardened LivenessCapture
 * state machine (which owns consent, camera permission, the real AWS session
 * start/poll, and every failure/provider state). This is NOT Blue-Badge
 * verification and requires no identity document - copy is deliberately plain.
 */

const TRUST_POINTS: { icon: typeof Clock; text: string }[] = [
  { icon: Clock, text: "Takes about 10-15 seconds" },
  { icon: IdCard, text: "No identity document is required" },
  { icon: ShieldCheck, text: "Helps keep fake accounts out" },
  { icon: Sparkles, text: "This is normally completed only once" },
];

export function LivenessEntryStep({ consentVersion }: { consentVersion: string }) {
  const router = useRouter();

  return (
    <AuthCard>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <p className="text-gold text-xs font-semibold tracking-[0.28em] uppercase">
            One last step
          </p>
          <h1 className="font-display text-2xl font-medium tracking-tight">
            Your profile is ready
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Complete one quick face check before you start meeting people on Tirvea.
          </p>
        </header>

        <ul className="flex flex-col gap-3">
          {TRUST_POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-sm">
              <span className="glass-chip flex size-8 shrink-0 items-center justify-center rounded-full">
                <Icon className="text-gold size-4" aria-hidden="true" />
              </span>
              <span className="text-foreground/90">{text}</span>
            </li>
          ))}
        </ul>

        {/* The real AWS Face Liveness flow: consent -> camera -> capture ->
            processing -> pass/fail. On PASS the server (face-liveness.ts)
            stamps livenessPassedAt and runs the canonical activator; onDone
            fires once the job reaches the checking state, so we route to the
            canonical post-registration destination. */}
        <LivenessCapture
          consentVersion={consentVersion}
          startLabel="Start Face Verification"
          onDone={() => router.push("/discover")}
        />

        <footer className="text-muted-foreground flex flex-col gap-3 text-xs leading-relaxed">
          <p>
            By continuing you agree to the biometric face check described in our{" "}
            <a href={LEGAL_ROUTES.biometricData} className="text-foreground/80 underline">
              Biometric data notice
            </a>{" "}
            and{" "}
            <a href={LEGAL_ROUTES.privacy} className="text-foreground/80 underline">
              Privacy Policy
            </a>
            . You can leave and finish this later - we&apos;ll bring you back here.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link
              href="/legal/contact"
              className="hover:text-foreground underline underline-offset-2"
            >
              Contact support
            </Link>
            <Link href="/" className="hover:text-foreground underline underline-offset-2">
              Not now
            </Link>
          </div>
        </footer>
      </div>
    </AuthCard>
  );
}
