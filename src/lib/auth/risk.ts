import { db } from "@/lib/db";
import { isDisposableEmail } from "@/lib/auth/disposable-domains";
import { buildIpIntelProviderFromEnv } from "@/lib/auth/ip-intel";

/**
 * Login risk engine - additive 0-100 score built ONLY from signals we can
 * actually observe in our own data (Device rows, AuthVerificationEvent
 * audit trail, User risk columns). Nothing is fabricated: signals that
 * would need an external IP-intelligence service (VPN / TOR / ASN
 * reputation / geo) sit behind a provider hook that contributes ZERO
 * until a real provider is configured, and the riskReason records
 * 'ip-intel:unavailable' so admins can see the blind spot.
 */

/** Score at or above this = high risk (step-up verification on login). */
export const RISK_THRESHOLD = 40;

const HOUR_MS = 60 * 60 * 1000;

/** Signal weights - additive, capped at 100. */
export const RISK_WEIGHTS = {
  /** Device hash never seen for this user (not in Device table). */
  new_device: 25,
  /** IP hash differs from the previous login's IP hash. */
  ip_changed: 15,
  /** Email domain is on the disposable-provider blocklist. */
  disposable_email: 20,
  /** >=3 otp_verify_fail events in the last hour. */
  otp_fails_3plus: 15,
  /** >=6 otp_verify_fail events in the last hour (replaces the 3+ tier). */
  otp_fails_6plus: 30,
  /** >=3 email_otp_send events in the last hour (send velocity). */
  otp_send_velocity: 10,
  /** Ban was lifted (bannedAt cleared but banReason retained). */
  previously_banned: 20,
  /** Admin flagged the account (riskReason starting 'admin:'). */
  admin_flagged: 40,
  /** IP-intel provider signals - contribute 0 until a provider exists. */
  "ip-intel:vpn": 15,
  "ip-intel:tor": 30,
} as const;

// ---------------------------------------------------------------------------
// IP-intelligence provider hook (VPN / TOR / ASN / geo)
// ---------------------------------------------------------------------------

export type IpIntelResult = {
  vpn: boolean | null;
  tor: boolean | null;
  asn: string | null;
  country: string | null;
};

export interface IpIntelProvider {
  readonly name: string;
  /** False = the provider is a stub; its signals must contribute 0. */
  readonly configured: boolean;
  /**
   * The RAW ip is accepted here because external intel services key on
   * it - it is passed TRANSIENTLY for this one call and never stored.
   * Only the derived results (vpn/tor/asn/country) may be persisted.
   */
  lookup(rawIp: string): Promise<IpIntelResult>;
}

const NULL_INTEL: IpIntelResult = { vpn: null, tor: null, asn: null, country: null };

/** Default stub - no external service wired up yet. */
export const notConfiguredIpIntel: IpIntelProvider = {
  name: "not-configured",
  configured: false,
  lookup: async () => NULL_INTEL,
};

let ipIntelProvider: IpIntelProvider = notConfiguredIpIntel;

export function getIpIntelProvider(): IpIntelProvider {
  // Lazy env resolution: with IP_INTEL_API_KEY set the real adapter
  // (ip-intel.ts - ipqs/ipinfo) replaces the stub on first use. An explicit
  // setIpIntelProvider (tests) always wins. No import cycle: ip-intel.ts
  // imports only TYPES from this module (erased at runtime).
  if (ipIntelProvider === notConfiguredIpIntel) {
    const fromEnv = buildIpIntelProviderFromEnv();
    if (fromEnv) ipIntelProvider = fromEnv;
  }
  return ipIntelProvider;
}

/** Wire up a real provider (ipinfo/ipqs/maxmind adapter) or a test stub. */
export function setIpIntelProvider(provider: IpIntelProvider): void {
  ipIntelProvider = provider;
}

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------

/** The slice of User the risk engine reads (pass the full row freely). */
export type RiskUser = {
  id: string;
  email: string;
  bannedAt: Date | null;
  banReason: string | null;
  riskReason: string | null;
  lastLoginIpHash: string | null;
};

export type RiskContext = {
  /** Salted hash of the requesting IP (never the raw IP). */
  ipHash: string | null;
  /** Salted device hash from registerDevice / deviceHashFor. */
  deviceHash: string | null;
  /** Defaults to the domain of user.email. */
  emailDomain?: string;
  /**
   * IP hash of the PREVIOUS login. Pass this when the login stamps were
   * already overwritten (ensureAppUser returns previousLoginIpHash);
   * defaults to user.lastLoginIpHash otherwise.
   */
  previousIpHash?: string | null;
  /**
   * Whether the device was absent from the Device table BEFORE this
   * login registered it. Pass registerDevice().isNewDevice when the
   * device is already registered; when omitted the table is queried.
   */
  newDevice?: boolean;
  /** Raw IP, passed transiently to the intel provider only. NEVER stored. */
  rawIp?: string | null;
};

export type RiskEvaluation = {
  score: number;
  /** Signal names, joined into User.riskReason. */
  reasons: string[];
  highRisk: boolean;
};

/**
 * Compute, persist and return the login risk score for a user.
 * Persists riskScore / riskReason (joined signal names) / riskUpdatedAt,
 * plus lastIpCountry/lastIpAsn when a real intel provider supplied them.
 *
 * An existing admin flag (riskReason starting 'admin:') is carried
 * forward into the new riskReason so re-evaluation never silently clears
 * an admin decision - only an admin editing riskReason removes it.
 */
export async function computeRiskScore(user: RiskUser, ctx: RiskContext): Promise<RiskEvaluation> {
  let score = 0;
  const reasons: string[] = [];
  const add = (signal: keyof typeof RISK_WEIGHTS, label?: string) => {
    score += RISK_WEIGHTS[signal];
    reasons.push(label ?? signal);
  };

  // Admin flag first so it always leads the persisted riskReason
  if (user.riskReason?.startsWith("admin:")) {
    const adminToken = user.riskReason.split(",")[0].trim();
    add("admin_flagged", adminToken);
  }

  // New device - not in the Device table for this user
  if (ctx.deviceHash) {
    const isNew =
      ctx.newDevice ??
      !(await db.device.findUnique({
        where: { userId_fingerprint: { userId: user.id, fingerprint: ctx.deviceHash } },
        select: { id: true },
      }));
    if (isNew) add("new_device");
  }

  // IP hash changed from the previous login
  const previousIpHash =
    ctx.previousIpHash !== undefined ? ctx.previousIpHash : user.lastLoginIpHash;
  if (previousIpHash && ctx.ipHash && previousIpHash !== ctx.ipHash) add("ip_changed");

  // Disposable email domain
  const emailDomain = ctx.emailDomain ?? user.email.split("@").pop() ?? "";
  if (emailDomain && isDisposableEmail(`probe@${emailDomain}`)) add("disposable_email");

  // Recent OTP verification failures (audit trail, last hour)
  const since = new Date(Date.now() - HOUR_MS);
  const fails = await db.authVerificationEvent.count({
    where: {
      type: "otp_verify_fail",
      createdAt: { gte: since },
      OR: [{ userId: user.id }, { email: user.email.toLowerCase() }],
    },
  });
  if (fails >= 6) add("otp_fails_6plus");
  else if (fails >= 3) add("otp_fails_3plus");

  // Send velocity: repeated OTP requests inside the hour
  const sends = await db.authVerificationEvent.count({
    where: {
      type: "email_otp_send",
      createdAt: { gte: since },
      OR: [{ userId: user.id }, { email: user.email.toLowerCase() }],
    },
  });
  if (sends >= 3) add("otp_send_velocity");

  // Previously banned: bannedAt was cleared (an active ban never reaches
  // this code - ensureAppUser rejects it) but the banReason remains as
  // the stored evidence of the past ban.
  if (!user.bannedAt && user.banReason) add("previously_banned");

  // External IP intelligence - hook only; contributes 0 until configured
  let intel: IpIntelResult = NULL_INTEL;
  const provider = getIpIntelProvider();
  if (provider.configured && ctx.rawIp) {
    try {
      intel = await provider.lookup(ctx.rawIp);
    } catch (error) {
      console.warn(`[auth:risk] ip-intel lookup failed: ${String(error).slice(0, 80)}`);
    }
  }
  if (intel.vpn === true) add("ip-intel:vpn");
  if (intel.tor === true) add("ip-intel:tor");
  if (intel.vpn === null && intel.tor === null && intel.asn === null && intel.country === null) {
    reasons.push("ip-intel:unavailable"); // 0 points - marks the blind spot
  }

  score = Math.min(100, score);
  const evaluation: RiskEvaluation = { score, reasons, highRisk: score >= RISK_THRESHOLD };

  await db.user.update({
    where: { id: user.id },
    data: {
      riskScore: score,
      riskReason: reasons.join(","),
      riskUpdatedAt: new Date(),
      ...(intel.country ? { lastIpCountry: intel.country } : {}),
      ...(intel.asn ? { lastIpAsn: intel.asn } : {}),
    },
  });

  return evaluation;
}
