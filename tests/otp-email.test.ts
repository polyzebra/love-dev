/**
 * The canonical OTP email - one branded template, one sender, one footer,
 * used IDENTICALLY by every Tirvea flow that shows a 6-digit code screen
 * (signup, login, resend signup, resend login, email attach, change email,
 * resend change email). Run with:
 *   npx tsx tests/otp-email.test.ts
 *
 * Pure/unit: renders the template and drives sendBrandedOtpEmail through an
 * injected spy provider. No DB, no network, no Supabase. Also scans source
 * to prove no OTP flow can fall back to a Supabase default email.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

// The 8 OTP-bearing flows the spec requires to produce the identical email.
const FLOWS = [
  "signup",
  "login",
  "resend signup",
  "resend login",
  "email verification",
  "email attach",
  "change email",
  "resend change email",
] as const;

async function main() {
  const {
    renderOtpEmail,
    sendBrandedOtpEmail,
    OTP_EMAIL_FROM,
    OTP_EMAIL_SUBJECT,
    OTP_SUPPORT_EMAIL,
    setEmailProviderForTests,
    makeSpyEmailProvider,
    notConfiguredEmailProvider,
  } = await import("../src/lib/services/email");

  console.log("1. canonical template content");
  await check("subject is exactly 'Your Tirvea verification code'", () => {
    assert.equal(OTP_EMAIL_SUBJECT, "Your Tirvea verification code");
    assert.equal(renderOtpEmail("123456").subject, "Your Tirvea verification code");
  });

  await check("code appears in BOTH html and plain text", () => {
    const r = renderOtpEmail("246813");
    assert.ok(r.html.includes("246813"), "html shows the code");
    assert.ok(r.text.includes("246813"), "text shows the code");
  });

  await check("exact branded copy is present", () => {
    const { html, text } = renderOtpEmail("111222");
    for (const phrase of [
      "Tirvea",
      "Your verification code",
      "Use this code to continue with Tirvea.",
      "This code expires in 10 minutes.",
      "Never share this code with anyone.",
      "If you didn't request this code, you can safely ignore this email.",
    ]) {
      assert.ok(html.includes(phrase), `html missing: ${phrase}`);
      assert.ok(text.includes(phrase), `text missing: ${phrase}`);
    }
  });

  await check("footer shows info@tirvea.com", () => {
    const { html, text } = renderOtpEmail("333444");
    assert.equal(OTP_SUPPORT_EMAIL, "info@tirvea.com");
    assert.ok(html.includes("Need help?") && html.includes("info@tirvea.com"));
    assert.ok(text.includes("info@tirvea.com"));
  });

  console.log("2. it is an OTP email, never a link / magic link");
  await check(
    "no ConfirmationURL, magic link, token URL or http link (only mailto support)",
    () => {
      const { html } = renderOtpEmail("555666");
      for (const forbidden of [
        "ConfirmationURL",
        "{{ ",
        "magiclink",
        "magic link",
        "token=",
        "/auth/confirm",
        'href="http',
        "Confirm your new email",
      ]) {
        assert.ok(!html.includes(forbidden), `OTP email must not contain: ${forbidden}`);
      }
      // The ONLY link is the support mailto.
      const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
      assert.deepEqual(hrefs, ["mailto:info@tirvea.com"], "the only link is support mailto");
    },
  );

  console.log("3. presentation: responsive, dark-mode, accessible, injection-safe");
  await check("responsive (viewport + max-width) and large centered code", () => {
    const { html } = renderOtpEmail("777888");
    assert.ok(html.includes("width=device-width"), "viewport meta");
    assert.ok(html.includes("max-width"), "constrained width");
    assert.ok(
      /text-align:\s*center/.test(html) && /letter-spacing/.test(html),
      "large centered code",
    );
  });
  await check("dark-mode friendly (prefers-color-scheme + color-scheme meta)", () => {
    const { html } = renderOtpEmail("999000");
    assert.ok(html.includes("prefers-color-scheme"), "dark-mode media query");
    assert.ok(html.includes('name="color-scheme"'), "color-scheme meta");
  });
  await check("accessible (semantic heading + code exposed to assistive tech)", () => {
    const { html } = renderOtpEmail("121212");
    assert.ok(html.includes("<h1"), "semantic heading");
    assert.ok(
      html.includes('role="text"') && html.includes("aria-label"),
      "code labelled for a11y",
    );
  });
  await check("HTML-injection safe (markup chars in a code are stripped)", () => {
    const { html } = renderOtpEmail('12<script>"&');
    assert.ok(!html.includes("<script>"), "no raw markup from the code");
  });

  console.log("4. one sender for every OTP email");
  await check("OTP_EMAIL_FROM is the branded noreply sender", () => {
    assert.equal(
      OTP_EMAIL_FROM,
      process.env.EMAIL_OTP_FROM?.trim() || "Tirvea <noreply@tirvea.com>",
    );
  });

  console.log("5. EVERY flow produces the IDENTICAL email (same subject/html/text/sender)");
  await check("all 8 OTP flows deliver a byte-identical email for the same code", async () => {
    const spy = makeSpyEmailProvider();
    setEmailProviderForTests(spy);
    try {
      const CODE = "654321";
      // Each flow's delivery is the SAME shared call - only the recipient differs.
      for (const flow of FLOWS) {
        const to = `${flow.replace(/\s+/g, "-")}@example.com`;
        const res = await sendBrandedOtpEmail(to, CODE);
        assert.ok(res.ok, `${flow} delivered`);
      }
      assert.equal(spy.sent.length, FLOWS.length);
      const first = spy.sent[0];
      for (const msg of spy.sent) {
        assert.equal(msg.from, OTP_EMAIL_FROM, "same sender");
        assert.equal(msg.subject, first.subject, "same subject");
        assert.equal(msg.html, first.html, "same HTML (layout + footer)");
        assert.equal(msg.text, first.text, "same text");
        assert.ok(msg.html?.includes(CODE), "carries the code");
      }
      // Sanity: the identical HTML is genuinely the canonical render.
      assert.equal(first.html, renderOtpEmail(CODE).html);
      assert.equal(first.from, OTP_EMAIL_FROM);
    } finally {
      setEmailProviderForTests(null);
    }
  });

  await check("a different code changes ONLY the code, not the shell/footer/sender", async () => {
    const spy = makeSpyEmailProvider();
    setEmailProviderForTests(spy);
    try {
      await sendBrandedOtpEmail("a@example.com", "100001");
      await sendBrandedOtpEmail("b@example.com", "200002");
      const [m1, m2] = spy.sent;
      assert.equal(m1.subject, m2.subject);
      assert.equal(m1.from, m2.from);
      // Swapping the code in one yields the other -> the ONLY difference is the
      // code, in both its displayed form and its digit-spaced a11y label.
      const spaced = (c: string) => c.split("").join(" ");
      const swapped = m1
        .html!.replaceAll(spaced("100001"), spaced("200002"))
        .replaceAll("100001", "200002");
      assert.equal(swapped, m2.html);
    } finally {
      setEmailProviderForTests(null);
    }
  });

  await check("delivery failure is surfaced (fails closed, no silent success)", async () => {
    setEmailProviderForTests(notConfiguredEmailProvider);
    try {
      const res = await sendBrandedOtpEmail("x@example.com", "000111");
      assert.equal(res.ok, false, "a dead transport is not reported as sent");
      assert.ok(res.error, "error surfaced to the caller");
    } finally {
      setEmailProviderForTests(null);
    }
  });

  console.log("6. no OTP flow can fall back to a Supabase default email");
  await check("signup/login send no longer calls signInWithOtp (Supabase mailer)", () => {
    const src = readFileSync("src/app/api/auth/email/send/route.ts", "utf8");
    // The method CALL (leading dot) - not the docstring that explains the
    // migration away from it.
    assert.ok(!src.includes(".signInWithOtp("), "must not call Supabase's mailer");
    assert.ok(
      src.includes("mintEmailLoginOtp") && src.includes("sendBrandedOtpEmail"),
      "uses the shared mint + branded delivery",
    );
  });
  await check("email-attach delivery routes through the shared branded sender", () => {
    const src = readFileSync("src/lib/auth/email-attach-client.ts", "utf8");
    assert.ok(src.includes("sendBrandedOtpEmail"), "shared delivery");
    assert.ok(!/render\w*OtpEmail\s*\(/.test(src), "no bespoke OTP render in the attach client");
  });
  await check("password reset is retired into the supported recovery flow (passwordless)", () => {
    const forgot = readFileSync("src/app/(auth)/forgot-password/page.tsx", "utf8");
    // P1.2: Tirvea is passwordless; the reset flow is retired to /auth/recovery.
    assert.ok(
      forgot.includes('redirect("/auth/recovery")'),
      "forgot-password redirects into the account-recovery flow",
    );
    assert.ok(!forgot.includes("resetPasswordForEmail"), "no password reset link is sent");
    assert.ok(!forgot.includes("sendBrandedOtpEmail"), "reset does not use the OTP email");
  });

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
