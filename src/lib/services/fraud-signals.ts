import { db } from "@/lib/db";
import type { TrustSignal } from "@/lib/services/trust-engine";

/**
 * Server-side fraud signals feeding the trust engine. Split by design:
 *  - PURE scoring functions (unit-tested, no IO) turn raw counts into
 *    TrustSignal entries with auditable names
 *  - collectFraudSignals(userId) gathers the raw counts from OUR OWN data
 *    (Device, AuthVerificationEvent, User, Verification, BannedCredential)
 *    and composes them - it is called from computeTrustProfile only
 *
 * Honesty notes:
 *  - impossible travel needs per-event geo. AuthVerificationEvent stores
 *    only ipHash (no country) and User.lastIpCountry is a single current
 *    value written only when a real IP-intel provider is configured
 *    (risk.ts). detectImpossibleTravel is therefore implemented + tested
 *    as a pure function, but the collector contributes ZERO until geo
 *    exists per event - it never guesses.
 *  - VPN/TOR ride the login risk engine's persisted riskReason (set only
 *    when the IP_INTEL provider is configured - see auth/ip-intel.ts);
 *    absent provider = absent signal, never a default.
 */

// ---------------------------------------------------------------------------
// Weights (additive on top of TRUST_ENGINE_WEIGHTS; total capped there)
// ---------------------------------------------------------------------------

export const FRAUD_WEIGHTS = {
  /** Device hash shared with exactly one other account. */
  device_multi_account: 20,
  /** Device hash shared with 2+ other accounts (replaces the tier above). */
  device_many_accounts: 30,
  /** 2+ accounts created on this device inside 7 days. */
  device_signup_velocity: 15,
  /** 3+ / 6+ distinct identities authenticating from this IP in 24h. */
  ip_velocity_3plus: 10,
  ip_velocity_6plus: 20,
  /** Another account shares the normalized (dots/+tag stripped) email. */
  email_alias_reuse: 25,
  /** 6+ OTP verify failures in 7 days. */
  verification_failures: 15,
  /** A provider verification (photo/identity) was rejected 2+ times. */
  verification_rejected_repeat: 15,
  /** The verified phone matches a ban-blocklist entry (post-unban etc). */
  phone_previously_banned: 30,
  /** Login risk engine recorded a VPN / TOR exit (real intel only). */
  ip_intel_vpn: 10,
  ip_intel_tor: 20,
  /** Scam-lexicon phrase in profile text. */
  fake_profile_lexicon: 15,
  /** Contact-handle pattern (whatsapp/telegram/number) in profile text. */
  fake_profile_contact: 10,
  /** Hollow profile shell (no photos AND near-empty profile). */
  fake_profile_hollow: 5,
} as const;

// ---------------------------------------------------------------------------
// Pure scoring functions
// ---------------------------------------------------------------------------

/** accountsOnDevice INCLUDES the user themselves. */
export function deviceReuseSignals(accountsOnDevice: number): TrustSignal[] {
  if (accountsOnDevice >= 3) {
    return [
      {
        name: `device_many_accounts_x${accountsOnDevice}`,
        points: FRAUD_WEIGHTS.device_many_accounts,
      },
    ];
  }
  if (accountsOnDevice === 2) {
    return [{ name: "device_multi_account", points: FRAUD_WEIGHTS.device_multi_account }];
  }
  return [];
}

export function velocitySignals(input: {
  /** Accounts whose Device row for a shared fingerprint is <7d old. */
  deviceSignups7d: number;
  /** Distinct identities in AuthVerificationEvent for this IP hash, 24h. */
  ipIdentities24h: number;
}): TrustSignal[] {
  const signals: TrustSignal[] = [];
  if (input.deviceSignups7d >= 2) {
    signals.push({
      name: `device_signup_velocity_x${input.deviceSignups7d}`,
      points: FRAUD_WEIGHTS.device_signup_velocity,
    });
  }
  if (input.ipIdentities24h >= 6) {
    signals.push({
      name: `ip_velocity_x${input.ipIdentities24h}`,
      points: FRAUD_WEIGHTS.ip_velocity_6plus,
    });
  } else if (input.ipIdentities24h >= 3) {
    signals.push({
      name: `ip_velocity_x${input.ipIdentities24h}`,
      points: FRAUD_WEIGHTS.ip_velocity_3plus,
    });
  }
  return signals;
}

/**
 * Normalize an email for reuse detection: lowercase, strip a +tag
 * everywhere, and strip dots in the local part for Gmail (where dots are
 * not significant). PURE - used by the collector's SQL equivalent.
 */
export function normalizeEmailForReuse(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 0) return trimmed;
  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replaceAll(".", "");
  }
  return `${local}@${domain}`;
}

export function emailReuseSignals(otherAccountsSharingNormalizedEmail: number): TrustSignal[] {
  return otherAccountsSharingNormalizedEmail >= 1
    ? [
        {
          name: `email_alias_reuse_x${otherAccountsSharingNormalizedEmail}`,
          points: FRAUD_WEIGHTS.email_alias_reuse,
        },
      ]
    : [];
}

export function verificationFailureSignals(input: {
  otpFails7d: number;
  rejectedVerifications: number;
}): TrustSignal[] {
  const signals: TrustSignal[] = [];
  if (input.otpFails7d >= 6) {
    signals.push({
      name: `verification_failures_x${input.otpFails7d}`,
      points: FRAUD_WEIGHTS.verification_failures,
    });
  }
  if (input.rejectedVerifications >= 2) {
    signals.push({
      name: `verification_rejected_x${input.rejectedVerifications}`,
      points: FRAUD_WEIGHTS.verification_rejected_repeat,
    });
  }
  return signals;
}

/** riskReason is the login risk engine's persisted signal list. */
export function ipIntelSignals(riskReason: string | null): TrustSignal[] {
  const signals: TrustSignal[] = [];
  const reasons = riskReason?.split(",").map((r) => r.trim()) ?? [];
  if (reasons.includes("ip-intel:tor")) {
    signals.push({ name: "ip_intel_tor", points: FRAUD_WEIGHTS.ip_intel_tor });
  } else if (reasons.includes("ip-intel:vpn")) {
    signals.push({ name: "ip_intel_vpn", points: FRAUD_WEIGHTS.ip_intel_vpn });
  }
  return signals;
}

/**
 * Impossible travel: two sightings in different countries closer together
 * than any plausible flight. PURE + tested; the collector passes an empty
 * list until per-event geo exists (requires the IP-intel provider - see
 * the module doc). Threshold: different countries within 2 hours.
 */
export const IMPOSSIBLE_TRAVEL_WINDOW_MS = 2 * 3600 * 1000;

export function detectImpossibleTravel(sightings: Array<{ country: string; at: Date }>): boolean {
  const sorted = [...sightings]
    .filter((s) => s.country)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  for (let i = 1; i < sorted.length; i++) {
    if (
      sorted[i].country !== sorted[i - 1].country &&
      sorted[i].at.getTime() - sorted[i - 1].at.getTime() < IMPOSSIBLE_TRAVEL_WINDOW_MS
    ) {
      return true;
    }
  }
  return false;
}

/** Curated scam lexicon (kept small + reviewable; case-insensitive). */
export const SCAM_LEXICON = [
  "whatsapp",
  "telegram",
  "wechat",
  "western union",
  "moneygram",
  "wire transfer",
  "gift card",
  "bitcoin",
  "crypto",
  "usdt",
  "forex",
  "investment opportunity",
  "sugar daddy",
  "sugar baby",
  "onlyfans",
  "cashapp",
  "cash app",
  "venmo",
  "paypal me",
] as const;

const CONTACT_PATTERN = /(\+\d{7,15})|(\b\d{9,15}\b)|(@[a-z0-9_]{4,})|(\bwa\.me\/)/i;

/**
 * Fake-profile scoring - PURE combination of the scam lexicon and profile
 * shape signals. Inputs come from data the user wrote themselves.
 */
export function fakeProfileSignals(input: {
  bio: string | null;
  promptAnswers: string[];
  photoCount: number;
  completionPct: number;
}): TrustSignal[] {
  const signals: TrustSignal[] = [];
  const text = [input.bio ?? "", ...input.promptAnswers].join("\n").toLowerCase();

  const lexiconHits = SCAM_LEXICON.filter((phrase) => text.includes(phrase));
  if (lexiconHits.length > 0) {
    signals.push({
      name: `fake_profile_lexicon_x${lexiconHits.length}`,
      points: FRAUD_WEIGHTS.fake_profile_lexicon,
    });
  }
  if (text.trim().length > 0 && CONTACT_PATTERN.test(text)) {
    signals.push({ name: "fake_profile_contact", points: FRAUD_WEIGHTS.fake_profile_contact });
  }
  if (input.photoCount === 0 && input.completionPct < 20) {
    signals.push({ name: "fake_profile_hollow", points: FRAUD_WEIGHTS.fake_profile_hollow });
  }
  return signals;
}

export function phoneBanSignals(phoneOnBanList: boolean): TrustSignal[] {
  return phoneOnBanList
    ? [{ name: "phone_previously_banned", points: FRAUD_WEIGHTS.phone_previously_banned }]
    : [];
}

// ---------------------------------------------------------------------------
// Collector (IO) - composed into computeTrustProfile
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 3600 * 1000;

export async function collectFraudSignals(user: {
  id: string;
  email: string;
  phoneE164: string | null;
  riskReason: string | null;
  lastLoginIpHash: string | null;
}): Promise<TrustSignal[]> {
  const userId = user.id;
  const now = Date.now();

  const myDevices = await db.device.findMany({
    where: { userId },
    select: { fingerprint: true },
    take: 20,
  });
  const fingerprints = myDevices.map((d) => d.fingerprint);

  const [
    deviceUsers,
    deviceSignups7d,
    otpFails7d,
    rejectedVerifications,
    phoneBanRow,
    profile,
    photoCount,
  ] = await Promise.all([
    fingerprints.length > 0
      ? db.device.findMany({
          where: { fingerprint: { in: fingerprints } },
          select: { userId: true },
          distinct: ["userId"],
        })
      : Promise.resolve([] as { userId: string }[]),
    fingerprints.length > 0
      ? db.device
          .findMany({
            where: {
              fingerprint: { in: fingerprints },
              createdAt: { gte: new Date(now - 7 * DAY_MS) },
            },
            select: { userId: true },
            distinct: ["userId"],
          })
          .then((rows) => rows.length)
      : Promise.resolve(0),
    db.authVerificationEvent.count({
      where: {
        type: "otp_verify_fail",
        createdAt: { gte: new Date(now - 7 * DAY_MS) },
        OR: [{ userId }, { email: user.email.toLowerCase() }],
      },
    }),
    db.verification.count({
      where: { userId, type: { in: ["PHOTO", "IDENTITY"] }, status: "REJECTED" },
    }),
    user.phoneE164
      ? db.bannedCredential.findUnique({
          where: { kind_value: { kind: "PHONE", value: user.phoneE164 } },
          select: { sourceUserId: true },
        })
      : Promise.resolve(null),
    db.profile.findUnique({
      where: { userId },
      select: { bio: true, completionPct: true, prompts: { select: { answer: true } } },
    }),
    db.photo.count({ where: { userId, status: "ACTIVE" } }),
  ]);

  // IP velocity: distinct identities seen from this user's last login IP
  // hash inside 24h (the audit trail records events even for rejections).
  let ipIdentities24h = 0;
  if (user.lastLoginIpHash) {
    const rows = await db.authVerificationEvent.findMany({
      where: { ipHash: user.lastLoginIpHash, createdAt: { gte: new Date(now - DAY_MS) } },
      select: { userId: true, email: true, phoneE164: true },
      take: 500,
    });
    const identities = new Set<string>();
    for (const row of rows) {
      identities.add(row.userId ?? row.email ?? row.phoneE164 ?? "anonymous");
    }
    identities.delete("anonymous");
    ipIdentities24h = identities.size;
  }

  // Email alias reuse: other accounts whose NORMALIZED email matches ours
  // (dots stripped for gmail, +tags stripped everywhere). Raw SQL mirrors
  // normalizeEmailForReuse; guarded like scam.ts's copy-paste query.
  let emailAliasReuse = 0;
  try {
    const normalized = normalizeEmailForReuse(user.email);
    const rows = await db.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM "User"
      WHERE id != ${userId}
        AND (
          CASE
            WHEN split_part(lower(email), '@', 2) IN ('gmail.com','googlemail.com')
            THEN replace(split_part(split_part(lower(email), '@', 1), '+', 1), '.', '')
            ELSE split_part(split_part(lower(email), '@', 1), '+', 1)
          END || '@' || split_part(lower(email), '@', 2)
        ) = ${normalized}`;
    emailAliasReuse = rows[0]?.n ?? 0;
  } catch (error) {
    console.warn(`[fraud] email-reuse query failed: ${String(error).slice(0, 80)}`);
  }

  return [
    ...deviceReuseSignals(deviceUsers.length),
    ...velocitySignals({ deviceSignups7d, ipIdentities24h }),
    ...emailReuseSignals(emailAliasReuse),
    ...verificationFailureSignals({ otpFails7d, rejectedVerifications }),
    // Phone banned but account alive = unban/edge case worth staff eyes.
    ...phoneBanSignals(!!phoneBanRow && phoneBanRow.sourceUserId !== userId),
    ...ipIntelSignals(user.riskReason),
    ...fakeProfileSignals({
      bio: profile?.bio ?? null,
      promptAnswers: profile?.prompts.map((p) => p.answer) ?? [],
      photoCount,
      completionPct: profile?.completionPct ?? 0,
    }),
    // Impossible travel: contributes nothing until per-event geo exists
    // (requires the IP-intel provider) - see detectImpossibleTravel.
  ];
}
