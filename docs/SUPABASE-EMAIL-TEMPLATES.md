# Supabase Email Templates — canonical source (paste into the dashboard)

The Tirvea UI shows a **6-digit code** entry screen for signup, login and
email-change. Supabase must therefore render `{{ .Token }}` (the code) in
those templates — **never `{{ .ConfirmationURL }}` as the primary
action**. Templates are dashboard-managed (Authentication → Emails);
there is no repo/Management-token path, so these must be pasted by hand.

Regression that caused this doc: the **Change Email Address** template
was still shipping `{{ .ConfirmationURL }}` (subject "Confirm your new
email address") while the app asked for a code — so the new address got a
link and code entry could never succeed. Fix = the HTML below.

Also required (Authentication → Providers → Email):
**"Secure email change" MUST be OFF** — see §5e of AUTH-SETUP.md and
`email-attach-flow.ts`. When ON, `updateUser({ email })` demands
confirmation from BOTH the old and new addresses; a phone-first account's
old address is an unroutable placeholder, so the change can never
complete, and single-side verify leaves `auth.users.email` unchanged.
(The app now fails safe here — verify returns `change_not_completed` and
never advances the app row — but the flow only _works_ with this OFF.)

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
| Change email (attach) | `updateUser({ email })`                              | Change Email Address        | `"email_change"`           | code             |
| Password reset        | reset email                                          | Reset Password              | — (link session)           | link             |
| Phone                 | `updateUser({ phone })` / `signInWithOtp({ phone })` | SMS                         | `"phone_change"` / `"sms"` | code (unchanged) |

Google/Apple OAuth issue no code and are unaffected.
