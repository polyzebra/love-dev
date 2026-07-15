# Supabase Email Templates — canonical source (paste into the dashboard)

The Tirvea UI shows a **6-digit code** entry screen for signup, login and
email-change. Supabase must therefore render `{{ .Token }}` (the code) in
those templates — **never `{{ .ConfirmationURL }}` as the primary
action**. Templates are dashboard-managed (Authentication → Emails);
there is no repo/Management-token path, so these must be pasted by hand.

Regression that caused this doc: the **Change Email Address** template
was still shipping `{{ .ConfirmationURL }}` (subject "Confirm your new
email address") while the app asked for a code — so the new address got a
link and code entry could never succeed.

> **UPDATE — change-email no longer depends on this template.** The
> email-attach / change-email flow now OWNS its delivery so it can never
> regress to a Supabase default template again: it mints the 6-digit code
> with `admin.generateLink({ type: "email_change_new" })` (which sends no
> Supabase email) and delivers a branded code through Tirvea's own Resend
> pipeline (`services/email.ts` → `renderEmailAttachOtpEmail`), then
> force-commits the address with `admin.updateUserById({ email,
email_confirm })`. See `src/lib/auth/email-attach-client.ts`.
> Consequences: **section 3 below is now dormant** (kept only in case
> Supabase's Change-Email email is ever re-enabled — the app does not use
> it), and **"Secure email change" is no longer a hard requirement** (the
> admin commit lands the change regardless of that toggle), though leaving
> it OFF keeps GoTrue's state clean. Signup / login (sections 1–2) still
> use Supabase templates and DO require `{{ .Token }}`.
>
> Delivery prerequisite (Resend): `EMAIL_FROM`'s domain (`tirvea.app`)
> must be a **verified domain on the Resend key in `RESEND_API_KEY`**, and
> that key must be allowed to send from it. A restricted/mis-scoped key
> makes the branded send fail (`send_failed`) — the code is correct but no
> email goes out.

---

## 1. Confirm signup + 2. Magic Link (signup / login OTP)

Subject (both):

```
Your Tirvea verification code
```

Body (both):

```html
<div
  style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a1a"
>
  <h1 style="font-size:20px;font-weight:600;margin:0 0 16px">Your Tirvea verification code</h1>
  <p style="font-size:15px;line-height:1.5;margin:0 0 24px;color:#444">
    Enter this code in Tirvea to continue:
  </p>
  <div
    style="font-size:34px;font-weight:700;letter-spacing:8px;text-align:center;padding:20px;background:#f5f5f5;border-radius:12px;margin:0 0 24px"
  >
    {{ .Token }}
  </div>
  <p style="font-size:13px;line-height:1.5;margin:0 0 8px;color:#666">
    This code expires shortly. Never share it with anyone.
  </p>
  <p style="font-size:13px;line-height:1.5;margin:0;color:#666">
    If you didn't request this code, you can ignore this email.
  </p>
</div>
```

## 3. Change Email Address (email-attach / change-email OTP) ← the fix

Subject:

```
Confirm your new Tirvea email address
```

Body — **must use `{{ .Token }}`**, not `{{ .ConfirmationURL }}`:

```html
<div
  style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a1a"
>
  <h1 style="font-size:20px;font-weight:600;margin:0 0 16px">Confirm your new email address</h1>
  <p style="font-size:15px;line-height:1.5;margin:0 0 24px;color:#444">
    Enter this code in Tirvea to confirm this email address on your account:
  </p>
  <div
    style="font-size:34px;font-weight:700;letter-spacing:8px;text-align:center;padding:20px;background:#f5f5f5;border-radius:12px;margin:0 0 24px"
  >
    {{ .Token }}
  </div>
  <p style="font-size:13px;line-height:1.5;margin:0 0 8px;color:#666">
    This code expires shortly. Never share it with anyone.
  </p>
  <p style="font-size:13px;line-height:1.5;margin:0;color:#666">
    If you didn't request this change, you can ignore this email — your account is unchanged.
  </p>
</div>
```

## 4. Reset Password (DO NOT convert to OTP)

Tirvea's password reset is **link-based** by design
(`/reset-password` opens a session from the emailed recovery link, then
`updateUser({ password })`). Leave this template using
`{{ .ConfirmationURL }}`. Do not paste an OTP body here.

```html
<div
  style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a1a"
>
  <h1 style="font-size:20px;font-weight:600;margin:0 0 16px">Reset your Tirvea password</h1>
  <p style="font-size:15px;line-height:1.5;margin:0 0 24px;color:#444">
    Tap the button below to choose a new password. This link expires shortly.
  </p>
  <a
    href="{{ .ConfirmationURL }}"
    style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 24px;border-radius:999px"
    >Reset password</a
  >
  <p style="font-size:13px;line-height:1.5;margin:24px 0 0;color:#666">
    If you didn't request this, you can safely ignore this email.
  </p>
</div>
```

---

## verifyOtp type per flow (app side — already correct)

| Flow                  | Send                                                 | Template                    | verifyOtp type             | UI shows         |
| --------------------- | ---------------------------------------------------- | --------------------------- | -------------------------- | ---------------- |
| Signup / login        | `signInWithOtp({ email })`                           | Confirm signup / Magic Link | `"email"`                  | code             |
| Change email (attach) | `generateLink` + Resend (Tirvea-owned)               | none (app-branded)          | `"email_change"` + commit  | code             |
| Password reset        | reset email                                          | Reset Password              | — (link session)           | link             |
| Phone                 | `updateUser({ phone })` / `signInWithOtp({ phone })` | SMS                         | `"phone_change"` / `"sms"` | code (unchanged) |

Google/Apple OAuth issue no code and are unaffected.
