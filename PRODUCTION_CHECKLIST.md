# Virelsy - Production Checklist

## Security

- [ ] `AUTH_SECRET` generated fresh for production (`npx auth secret`)
- [ ] Seeded admin/demo passwords rotated or seed skipped in production
- [ ] HTTPS enforced end-to-end; HSTS header active (configured in `next.config.ts`)
- [ ] Rate-limit store moved to Redis (Upstash) for multi-instance deployments
- [ ] CAPTCHA wired into register/login (hooks in place at the rate-limit guards)
- [ ] Dependency audit clean: `npm audit --omit=dev`
- [ ] CSP header tuned and enabled after asset origins are final

## Database

- [ ] Supabase/PostgreSQL provisioned in EU region (GDPR)
- [ ] `DATABASE_URL` (pooled) + `DIRECT_URL` (direct) both set
- [ ] `npx prisma migrate deploy` in the release pipeline
- [ ] Automated backups + point-in-time recovery enabled
- [ ] Scheduled job: hard-delete accounts 30 days after `deletionRequested`
- [ ] Scheduled job: purge expired `VerificationToken` rows

## Auth

- [ ] Google OAuth consent screen verified; production redirect URIs added
- [ ] Apple Sign In service ID + key configured
- [ ] Email deliverability: RESEND_API_KEY set, SPF/DKIM/DMARC on the sending domain
- [ ] Phone OTP provider (e.g. Twilio Verify) connected to the OTP token flow

## Payments

- [ ] Stripe products created with lookup keys `amora_plus_monthly`, `amora_premium_monthly`
- [ ] Webhook endpoint `/api/webhooks/stripe` registered; `STRIPE_WEBHOOK_SECRET` set
- [ ] Signature verification enabled (swap the TODO in the webhook for `stripe.webhooks.constructEvent`)
- [ ] Checkout + billing portal sessions implemented with the official `stripe` SDK
- [ ] VAT/MOSS configuration reviewed for IE/UK

## Media & verification

- [ ] Photo upload storage (Supabase Storage / S3) with WebP/AVIF conversion + blur placeholders
- [ ] Image moderation provider connected (photo `moderation` field is ready)
- [ ] Photo/ID verification provider (Veriff / Stripe Identity) connected - status-only storage

## Realtime

- [ ] Chat transport upgraded from polling to WebSocket/SSE (Supabase Realtime or Pusher);
      service layer (`lib/services/chat.ts`) already isolates the transport

## Performance

- [ ] Lighthouse ≥ 95 on landing, login, discover (mobile)
- [ ] Images served via `next/image` with real remote patterns
- [ ] Bundle check: `next build` size budget reviewed
- [ ] Discovery distance filter moved to PostGIS `earth_distance` at scale

## Observability

- [ ] Error tracking (Sentry) on server + client
- [ ] Structured logs shipped (Axiom/Datadog); audit log retention policy set
- [ ] Uptime monitoring on `/api/health`

## Compliance

- [ ] Privacy policy & terms reviewed by counsel (IE + UK)
- [ ] Cookie/consent banner if analytics/marketing cookies are added
- [ ] Age gate verified (18+) - enforced in validation, verify at ID check too
- [ ] Data Protection Impact Assessment (DPIA) completed
- [ ] Safety team escalation runbook (24h SLA on severe reports)

## Launch

- [ ] Custom domain + `NEXT_PUBLIC_APP_URL` updated
- [ ] OG images and favicons finalised
- [ ] Sitemap + robots.txt
- [ ] Support inbox (hello@ / safety@ / privacy@) routed
