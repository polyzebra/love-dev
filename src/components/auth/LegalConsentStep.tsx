"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthErrorBanner } from "@/components/auth/AuthErrorBanner";
import { AuthSubmitButton } from "@/components/auth/AuthSubmitButton";
import { acceptConsent } from "@/components/auth/api";

/**
 * Step 5 of 5 - legal consent. The three documents open in new tabs so
 * the flow is never lost; ONE checkbox covers all of them and the CTA
 * stays disabled until it's checked. POST /api/auth/consent stamps the
 * current versions (a later version bump routes people back here).
 */

const DOCUMENTS = [
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/settings/community-guidelines", label: "Community Guidelines" },
] as const;

export function LegalConsentStep() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!checked || pending) return;
    setPending(true);
    setError(null);
    const result = await acceptConsent();
    if (result.ok) {
      router.replace(result.next);
      return; // Keep the disabled state while the route changes.
    }
    setPending(false);
    setError(result.message);
  }

  return (
    <AuthShell
      step={5}
      title="A few ground rules"
      subtitle="Have a look at what you're agreeing to - each opens in a new tab."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-1 flex-col"
        noValidate
      >
        <ul className="space-y-2">
          {DOCUMENTS.map((doc) => (
            <li key={doc.href}>
              <Link
                href={doc.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-input bg-foreground/5 px-4 py-3 text-sm text-foreground shadow-[inset_0_1px_0_var(--glass-highlight)] transition-colors outline-none hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-foreground/20"
              >
                {doc.label}
                <ArrowUpRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>

        <label
          htmlFor="legal-consent"
          className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border border-input bg-foreground/5 px-4 py-3.5 shadow-[inset_0_1px_0_var(--glass-highlight)] transition-colors select-none hover:border-foreground/25 has-disabled:cursor-not-allowed has-disabled:opacity-70"
        >
          <Checkbox
            id="legal-consent"
            checked={checked}
            onCheckedChange={(value) => setChecked(value === true)}
            disabled={pending}
            className="mt-px size-5 rounded-md"
          />
          <span className="text-sm leading-snug text-foreground">
            I agree to the Terms of Service, Privacy Policy and Community
            Guidelines.
          </span>
        </label>

        <AuthErrorBanner message={error} className="mt-4" />

        <div className="mt-auto pt-8">
          <AuthSubmitButton pending={pending} disabled={!checked || pending}>
            Agree and continue
          </AuthSubmitButton>
        </div>
      </form>
    </AuthShell>
  );
}
