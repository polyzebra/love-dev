"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthFormStack } from "@/components/auth/AuthFormStack";
import { AuthErrorBanner } from "@/components/auth/AuthErrorBanner";
import { AuthSubmitButton } from "@/components/auth/AuthSubmitButton";
import { confirmAge } from "@/components/auth/api";

/**
 * Step 4 of 5 - the 18+ confirmation. One deliberate action: a single
 * large checkbox row (the whole row is the tap target, 44px+) and a CTA
 * that stays disabled until it's checked. POST /api/auth/age-confirm is
 * idempotent and answers with the gate's next step.
 */
export function AgeConfirmStep() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!checked || pending) return;
    setPending(true);
    setError(null);
    const result = await confirmAge();
    if (result.ok) {
      router.replace(result.next);
      return; // Keep the disabled state while the route changes.
    }
    setPending(false);
    setError(result.message);
  }

  return (
    <AuthShell
      step={4}
      title="You must be 18 or older"
      subtitle="Tirvea is for adults only. This one's a legal requirement."
    >
      <AuthFormStack
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        field={
          <label
            htmlFor="age-confirm"
            className="border-input bg-foreground/5 hover:border-foreground/25 flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3.5 shadow-[inset_0_1px_0_var(--glass-highlight)] transition-colors select-none has-disabled:cursor-not-allowed has-disabled:opacity-70"
          >
            <Checkbox
              id="age-confirm"
              checked={checked}
              onCheckedChange={(value) => setChecked(value === true)}
              disabled={pending}
              className="size-5 rounded-md"
            />
            <span className="text-foreground text-sm leading-snug">
              I confirm I am at least 18 years old.
            </span>
          </label>
        }
        status={<AuthErrorBanner message={error} />}
        cta={
          <AuthSubmitButton pending={pending} disabled={!checked || pending}>
            Continue
          </AuthSubmitButton>
        }
        footnote="Lying about your age gets accounts permanently removed."
      />
    </AuthShell>
  );
}
