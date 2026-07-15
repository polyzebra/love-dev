import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Email transport - provider abstraction for the notification outbox.
 *
 * The outbox (notify.ts) writes EMAIL NotificationDelivery rows; the worker
 * (processPendingEmail) renders the message and hands it to the provider
 * selected here. Honesty rules are inherited and extended:
 *  - a delivery is only SENT when the provider accepted it (message id kept)
 *  - no key -> notConfiguredEmailProvider -> the row stays/goes DEAD with
 *    errorCode "not_configured"; nothing is ever fake-sent
 *  - permanent provider rejections (4xx) FAIL immediately; transient ones
 *    (429/5xx/network) retry with backoff up to MAX_EMAIL_ATTEMPTS
 *  - suppressed addresses (hard bounce / complaint) are never sent to again
 *
 * Adapters:
 *  - resend  (RESEND_API_KEY + EMAIL_FROM)  - implemented, plain REST
 *  - ses / postmark                          - follow the same interface;
 *    add an adapter + a case in pickEmailProvider, nothing else changes
 *  - spy                                     - tests only (setEmailProviderForTests)
 */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Sender override. Defaults to EMAIL_FROM. OTP mail uses OTP_EMAIL_FROM. */
  from?: string;
  /** Stable key so a provider-side retry cannot double-send. */
  idempotencyKey?: string;
};

export type EmailSendResult =
  | { ok: true; providerMessageId: string | null }
  | {
      ok: false;
      /** True = worth retrying (429/5xx/network); false = permanent. */
      transient: boolean;
      errorCode: string;
      errorMessage: string;
    };

export interface EmailProvider {
  readonly name: string;
  /** False = adapter present but env missing; the outbox goes DEAD honest. */
  readonly configured: boolean;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/** Honest default: refuses instead of pretending to deliver. */
export const notConfiguredEmailProvider: EmailProvider = {
  name: "none",
  configured: false,
  async send(): Promise<EmailSendResult> {
    return {
      ok: false,
      transient: false,
      errorCode: "not_configured",
      errorMessage: "No email provider is configured (set RESEND_API_KEY).",
    };
  },
};

// ---------------------------------------------------------------------------
// Resend adapter (plain REST - https://resend.com/docs/api-reference)
// ---------------------------------------------------------------------------

const RESEND_API_URL = "https://api.resend.com/emails";
export const EMAIL_SEND_TIMEOUT_MS = 10_000;

function resendKey(): string | null {
  const key = process.env.RESEND_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

function emailFrom(): string {
  return process.env.EMAIL_FROM?.trim() || "Tirvea <hello@tirvea.app>";
}

export const resendEmailProvider: EmailProvider = {
  name: "resend",
  get configured() {
    return !!resendKey();
  },
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const key = resendKey();
    if (!key) {
      return {
        ok: false,
        transient: false,
        errorCode: "not_configured",
        errorMessage: "RESEND_API_KEY is not set.",
      };
    }
    let res: Response;
    try {
      res = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: message.from?.trim() || emailFrom(),
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
        signal: AbortSignal.timeout(EMAIL_SEND_TIMEOUT_MS),
      });
    } catch (error) {
      return {
        ok: false,
        transient: true, // network error / timeout - retry
        errorCode: "network_error",
        errorMessage: error instanceof Error ? error.message : "fetch failed",
      };
    }
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { id?: unknown };
      return { ok: true, providerMessageId: typeof body.id === "string" ? body.id : null };
    }
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    return {
      ok: false,
      transient: res.status === 429 || res.status >= 500,
      errorCode: `http_${res.status}`,
      errorMessage: detail || res.statusText,
    };
  },
};

// ---------------------------------------------------------------------------
// Spy provider (tests only - never selected by env)
// ---------------------------------------------------------------------------

let testProvider: EmailProvider | null = null;

/** Inject a spy/stub provider for tests; pass null to restore env selection. */
export function setEmailProviderForTests(provider: EmailProvider | null): void {
  testProvider = provider;
}

/** Build a recording spy provider for tests. */
export function makeSpyEmailProvider(
  behavior: (message: EmailMessage) => EmailSendResult | Promise<EmailSendResult> = () => ({
    ok: true,
    providerMessageId: `spy_${Math.random().toString(36).slice(2)}`,
  }),
): EmailProvider & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    name: "spy",
    configured: true,
    sent,
    async send(message: EmailMessage): Promise<EmailSendResult> {
      sent.push(message);
      return behavior(message);
    },
  };
}

export function pickEmailProvider(): EmailProvider {
  if (testProvider) return testProvider;
  if (resendKey()) return resendEmailProvider;
  // SES / Postmark adapters slot in here (implement EmailProvider, select on
  // AWS_SES_* / POSTMARK_SERVER_TOKEN). Until then: honest not-configured.
  return notConfiguredEmailProvider;
}

export function isEmailConfigured(): boolean {
  return pickEmailProvider().configured;
}

// ---------------------------------------------------------------------------
// Rendering - short, professional, deep link to /account/status
// ---------------------------------------------------------------------------

function siteOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:3000"
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export type RenderedEmail = { subject: string; text: string; html: string };

/**
 * The sender for EVERY 6-digit OTP email (signup, login, resend, email
 * attach, change email). One branded address, overridable via env for
 * environments whose Resend key is verified for a different domain.
 */
export const OTP_EMAIL_FROM = process.env.EMAIL_OTP_FROM?.trim() || "Tirvea <noreply@tirvea.com>";

/** Support address shown in the OTP email footer. */
export const OTP_SUPPORT_EMAIL = "support@tirvea.com";

/** The canonical OTP subject - identical across every flow. */
export const OTP_EMAIL_SUBJECT = "Your Tirvea verification code";

/**
 * THE canonical branded OTP email - the single source of truth for every
 * Tirvea flow that shows a 6-digit code screen (signup, login, resend,
 * email attach, change email, and their resends). There is exactly ONE
 * renderer and ONE subject so every flow produces an IDENTICAL email; the
 * code is DISPLAYED, never linked (no magic link, no ConfirmationURL), so
 * an OTP screen can never be paired with a link email. Password reset is
 * deliberately NOT an OTP flow and does not use this.
 *
 * Presentation: large centered code, responsive (max-width + fluid),
 * dark-mode friendly (prefers-color-scheme), accessible (semantic
 * heading, high contrast, the code exposed to assistive tech as text).
 */
/**
 * Deliver the canonical branded 6-digit OTP email - the SINGLE function
 * every flow (signup, login, resend, email attach, change email) calls to
 * send a code. Identical subject, HTML, footer and sender everywhere,
 * because it renders through renderOtpEmail and sends from OTP_EMAIL_FROM.
 * The OTP code is NEVER logged by callers.
 */
export async function sendBrandedOtpEmail(
  to: string,
  code: string,
): Promise<{ ok: boolean; error: { code?: string; message: string } | null }> {
  const rendered = renderOtpEmail(code);
  const result = await pickEmailProvider().send({
    to,
    from: OTP_EMAIL_FROM,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
  if (result.ok) return { ok: true, error: null };
  return { ok: false, error: { code: result.errorCode, message: result.errorMessage } };
}

export function renderOtpEmail(code: string): RenderedEmail {
  // Codes are digits from GoTrue; strip any markup character defensively
  // so a malformed value can never inject into the HTML shell.
  const safe = code.replace(/[<>&"']/g, "");
  const text = [
    "Tirvea",
    "",
    "Your verification code",
    "",
    "Use this code to continue with Tirvea.",
    "",
    `    ${safe}`,
    "",
    "This code expires in 10 minutes.",
    "Never share this code with anyone.",
    "",
    "If you didn't request this code, you can safely ignore this email.",
    "",
    `Need help? ${OTP_SUPPORT_EMAIL}`,
  ].join("\n");
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>${OTP_EMAIL_SUBJECT}</title>
    <style>
      :root { color-scheme: light dark; supported-color-schemes: light dark; }
      body { margin: 0; padding: 0; background: #faf7f5; }
      .wrap { width: 100%; background: #faf7f5; padding: 24px 0; }
      .card {
        max-width: 480px; margin: 0 auto; background: #ffffff;
        border: 1px solid #e7e0dc; border-radius: 16px; padding: 40px 32px;
        font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #1c1917;
      }
      .brand { margin: 0 0 24px; font-size: 15px; font-weight: 700; letter-spacing: .2px; color: #be123c; }
      .h1 { margin: 0 0 12px; font-size: 20px; line-height: 1.3; font-weight: 600; color: #1c1917; }
      .lead { margin: 0 0 28px; font-size: 15px; line-height: 1.6; color: #44403c; }
      .code {
        font-size: 34px; font-weight: 700; letter-spacing: 10px; text-align: center;
        padding: 22px 12px; background: #f5f2f0; border-radius: 12px; margin: 0 0 28px;
        color: #1c1917; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      }
      .meta { margin: 0 0 6px; font-size: 13px; line-height: 1.6; color: #78716c; }
      .hr { border: none; border-top: 1px solid #ece7e3; margin: 28px 0 20px; }
      .foot { margin: 0; font-size: 13px; line-height: 1.6; color: #78716c; }
      .foot a { color: #be123c; text-decoration: none; }
      @media (prefers-color-scheme: dark) {
        body, .wrap { background: #1c1917 !important; }
        .card { background: #262322 !important; border-color: #3a3634 !important; color: #f5f2f0 !important; }
        .h1 { color: #f5f2f0 !important; }
        .lead { color: #d6d1cd !important; }
        .code { background: #1c1917 !important; color: #f5f2f0 !important; }
        .meta, .foot { color: #a8a29e !important; }
        .hr { border-top-color: #3a3634 !important; }
        .brand, .foot a { color: #fb7185 !important; }
      }
    </style>
  </head>
  <body>
    <div class="wrap" role="article" aria-roledescription="email" aria-label="${OTP_EMAIL_SUBJECT}">
      <div class="card">
        <p class="brand">Tirvea</p>
        <h1 class="h1">Your verification code</h1>
        <p class="lead">Use this code to continue with Tirvea.</p>
        <div class="code" role="text" aria-label="Your verification code is ${safe.split("").join(" ")}">${safe}</div>
        <p class="meta">This code expires in 10 minutes.</p>
        <p class="meta">Never share this code with anyone.</p>
        <p class="meta">If you didn't request this code, you can safely ignore this email.</p>
        <hr class="hr" />
        <p class="foot">Need help? <a href="mailto:${OTP_SUPPORT_EMAIL}">${OTP_SUPPORT_EMAIL}</a></p>
      </div>
    </div>
  </body>
</html>`;
  return { subject: OTP_EMAIL_SUBJECT, text, html };
}

/**
 * Render one notification into an email. The notification title/body are
 * already the calm, legally-safe user copy (safety-notices.ts); this only
 * adds the shell + the deep link. `url` must be a same-origin path.
 */
export function renderNotificationEmail(input: {
  title: string;
  body: string | null;
  url?: string | null;
}): RenderedEmail {
  const path =
    typeof input.url === "string" && input.url.startsWith("/") && !input.url.startsWith("//")
      ? input.url
      : "/account/status";
  const link = `${siteOrigin()}${path}`;
  const body = input.body ?? "";
  const text = `${input.title}\n\n${body}\n\nView details: ${link}\n\n- The Tirvea Team\n\nYou received this because it concerns your Tirvea account.`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#faf7f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1917;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e7e0dc;">
    <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#be123c;">Tirvea</p>
    <h1 style="margin:0 0 12px;font-size:19px;line-height:1.35;">${escapeHtml(input.title)}</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#44403c;">${escapeHtml(body)}</p>
    <a href="${escapeHtml(link)}" style="display:inline-block;background:#be123c;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px;">View details</a>
    <p style="margin:28px 0 0;font-size:12px;color:#a8a29e;">You received this because it concerns your Tirvea account.</p>
  </div>
</body></html>`;
  return { subject: input.title, text, html };
}

// ---------------------------------------------------------------------------
// Webhook signature verification (Resend uses Svix headers)
// ---------------------------------------------------------------------------

export type EmailWebhookHeaders = {
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
};

/** Max clock skew a webhook timestamp may have (replay protection). */
export const EMAIL_WEBHOOK_TOLERANCE_S = 5 * 60;

/**
 * Verify a Svix-style signature (Resend webhooks): the secret is
 * "whsec_<base64>", the signed content is "{id}.{timestamp}.{rawBody}",
 * and the signature header carries space-separated "v1,<base64hmac>"
 * entries. Constant-time comparison; timestamp bounded against replay.
 */
export function verifyEmailWebhookSignature(
  rawBody: string,
  headers: EmailWebhookHeaders,
  secret: string,
  now: Date = new Date(),
): boolean {
  const { svixId, svixTimestamp, svixSignature } = headers;
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts)) return false;
  const skew = Math.abs(now.getTime() / 1000 - ts);
  if (skew > EMAIL_WEBHOOK_TOLERANCE_S) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key)
    .update(`${svixId}.${svixTimestamp}.${rawBody}`)
    .digest("base64");
  const expectedBuf = Buffer.from(expected, "utf8");

  for (const part of svixSignature.split(" ")) {
    const [version, sig] = part.split(",", 2);
    if (version !== "v1" || !sig) continue;
    const sigBuf = Buffer.from(sig, "utf8");
    if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

/** Test helper: produce a valid Svix signature for a payload. */
export function signEmailWebhook(
  rawBody: string,
  id: string,
  timestampSeconds: number,
  secret: string,
): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key)
    .update(`${id}.${timestampSeconds}.${rawBody}`)
    .digest("base64");
  return `v1,${sig}`;
}
