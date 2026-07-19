"use client";

import { useId, useRef, useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { InlineFieldError } from "@/components/ui/field-error";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_LIMITS,
  supportRequestSchema,
} from "@/lib/support/schema";
import { LEGAL_ROUTES } from "@/lib/legal/routes";

type FieldErrors = Partial<
  Record<"name" | "email" | "category" | "message" | "accountEmail", string>
>;
type Status = "idle" | "submitting" | "success" | "error";

const inputClass = "h-12";

export function ContactForm() {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [messageLen, setMessageLen] = useState(0);
  const [ticketId, setTicketId] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "submitting") return;
    setServerError(null);

    const form = new FormData(e.currentTarget);
    const payload = {
      name: String(form.get("name") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      category: String(form.get("category") ?? ""),
      message: String(form.get("message") ?? "").trim(),
      accountEmail: String(form.get("accountEmail") ?? "").trim(),
      reference: String(form.get("reference") ?? "").trim(),
      website: String(form.get("website") ?? ""), // honeypot
    };

    // Client validation mirrors the server schema.
    const parsed = supportRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setErrors({
        name: fieldErrors.name?.[0],
        email: fieldErrors.email?.[0],
        category: fieldErrors.category?.[0],
        message: fieldErrors.message?.[0],
        accountEmail: fieldErrors.accountEmail?.[0],
      });
      // Move focus to the first invalid field for keyboard/SR users.
      const firstInvalid = (["name", "email", "category", "message", "accountEmail"] as const).find(
        (k) => fieldErrors[k],
      );
      if (firstInvalid)
        formRef.current?.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    setErrors({});
    setStatus("submitting");

    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const json = (await res.json().catch(() => null)) as {
        data?: { ok?: boolean; id?: string };
        error?: { message?: string };
      } | null;
      if (res.ok && json?.data?.ok) {
        setTicketId(json.data.id ?? null);
        setStatus("success");
        return;
      }
      // Fail closed: any non-success is surfaced honestly, no fake confirmation.
      setServerError(
        json?.error?.message ??
          (res.status === 429
            ? "Too many messages from this connection. Please try again later."
            : "We couldn't send your message. Please try again."),
      );
      setStatus("error");
    } catch {
      setServerError("We couldn't reach the server. Please check your connection and try again.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="border-border rounded-3xl border p-8 text-center"
      >
        <CheckCircle2 className="text-success mx-auto size-12" aria-hidden="true" />
        <h2 className="font-display mt-4 text-2xl font-semibold tracking-tight">
          Message received
        </h2>
        <p className="text-muted-foreground mx-auto mt-2 max-w-md leading-relaxed">
          Thanks - your message has been logged and a person will read it. We&apos;ll reply to the
          email you gave us.
          {ticketId ? (
            <>
              {" "}
              Your reference is{" "}
              <span className="text-foreground font-mono text-sm">{ticketId}</span>.
            </>
          ) : null}
        </p>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5">
      {/* aria-live status region for the error banner. */}
      <div aria-live="assertive" className="empty:hidden">
        {status === "error" && serverError ? (
          <p
            role="alert"
            className="border-destructive/40 bg-destructive/10 text-destructive rounded-2xl border px-4 py-3 text-sm"
          >
            {serverError}
          </p>
        ) : null}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${uid}-name`}>
            Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id={`${uid}-name`}
            name="name"
            autoComplete="name"
            required
            maxLength={SUPPORT_LIMITS.name.max}
            className={inputClass}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${uid}-name-err` : undefined}
          />
          <InlineFieldError id={`${uid}-name-err`} message={errors.name} />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${uid}-email`}>
            Email <span className="text-destructive">*</span>
          </Label>
          <Input
            id={`${uid}-email`}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            maxLength={SUPPORT_LIMITS.email.max}
            className={inputClass}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? `${uid}-email-err` : undefined}
          />
          <InlineFieldError id={`${uid}-email-err`} message={errors.email} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${uid}-category`}>
          What is it about? <span className="text-destructive">*</span>
        </Label>
        <select
          id={`${uid}-category`}
          name="category"
          required
          defaultValue=""
          className="border-input bg-background focus-visible:ring-ring/60 h-12 w-full rounded-xl border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
          aria-invalid={errors.category ? true : undefined}
          aria-describedby={errors.category ? `${uid}-category-err` : undefined}
        >
          <option value="" disabled>
            Choose a category
          </option>
          {SUPPORT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {SUPPORT_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <InlineFieldError id={`${uid}-category-err`} message={errors.category} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${uid}-account`}>Account email (optional)</Label>
          <Input
            id={`${uid}-account`}
            name="accountEmail"
            type="email"
            inputMode="email"
            maxLength={SUPPORT_LIMITS.accountEmail.max}
            className={inputClass}
            placeholder="If different from above"
            aria-invalid={errors.accountEmail ? true : undefined}
            aria-describedby={errors.accountEmail ? `${uid}-account-err` : undefined}
          />
          <InlineFieldError id={`${uid}-account-err`} message={errors.accountEmail} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${uid}-ref`}>Reference / case number (optional)</Label>
          <Input
            id={`${uid}-ref`}
            name="reference"
            maxLength={SUPPORT_LIMITS.reference.max}
            className={inputClass}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={`${uid}-message`}>
            Message <span className="text-destructive">*</span>
          </Label>
          <span
            className={
              messageLen > SUPPORT_LIMITS.message.max
                ? "text-destructive text-xs"
                : "text-muted-foreground text-xs"
            }
            aria-live="polite"
          >
            {messageLen}/{SUPPORT_LIMITS.message.max}
          </span>
        </div>
        <Textarea
          id={`${uid}-message`}
          name="message"
          required
          rows={6}
          maxLength={SUPPORT_LIMITS.message.max}
          onChange={(e) => setMessageLen(e.currentTarget.value.length)}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={`${uid}-message-hint${errors.message ? ` ${uid}-message-err` : ""}`}
        />
        <p id={`${uid}-message-hint`} className="text-muted-foreground text-xs">
          Please don&apos;t include passwords or full card numbers.
        </p>
        <InlineFieldError id={`${uid}-message-err`} message={errors.message} />
      </div>

      {/* Honeypot: visually hidden and off the tab order; bots fill it, people don't. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor={`${uid}-website`}>Leave this field empty</label>
        <input id={`${uid}-website`} name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <Button
        type="submit"
        size="lg"
        className="h-12 w-full rounded-full"
        disabled={status === "submitting"}
      >
        {status === "submitting" ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : null}
        {status === "submitting" ? "Sending…" : "Send message"}
      </Button>

      <p className="text-muted-foreground text-xs leading-relaxed">
        By sending this form you agree to our{" "}
        <a href={LEGAL_ROUTES.privacy} className="underline">
          Privacy Policy
        </a>
        . We use your details only to answer your request. This form is protected against spam and
        rate-limited.
      </p>
    </form>
  );
}
