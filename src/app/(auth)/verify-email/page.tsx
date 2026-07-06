"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

function VerifyEmail() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const token = searchParams.get("token") ?? "";
  const [state, setState] = useState<"verifying" | "success" | "error">(() =>
    !email || !token ? "error" : "verifying",
  );

  useEffect(() => {
    if (!email || !token) return;
    let cancelled = false;
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, token }),
    })
      .then((res) => {
        if (!cancelled) setState(res.ok ? "success" : "error");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [email, token]);

  if (state === "verifying") {
    return (
      <div className="space-y-4 text-center" aria-live="polite">
        <Loader2 className="mx-auto size-10 animate-spin text-primary" aria-hidden="true" />
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Confirming your email…
        </h1>
      </div>
    );
  }

  if (state === "success") {
    return (
      <div className="space-y-4 text-center" aria-live="polite">
        <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden="true" />
        <h1 className="font-display text-3xl font-semibold tracking-tight">Email confirmed</h1>
        <p className="text-muted-foreground">You&apos;re all set. Sign in to build your profile.</p>
        <Button size="lg" className="rounded-full" asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-center" aria-live="polite">
      <XCircle className="mx-auto size-12 text-destructive" aria-hidden="true" />
      <h1 className="font-display text-3xl font-semibold tracking-tight">Link expired</h1>
      <p className="text-muted-foreground">
        This confirmation link is invalid or has expired. Sign in to request a new one.
      </p>
      <Button variant="outline" className="rounded-full" asChild>
        <Link href="/login">Back to sign in</Link>
      </Button>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
