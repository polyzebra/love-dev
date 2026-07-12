import type { IpIntelProvider, IpIntelResult } from "@/lib/auth/risk";

/**
 * IP-intelligence adapters (VPN / TOR / ASN / country) behind
 * IP_INTEL_API_KEY (+ IP_INTEL_PROVIDER = "ipqs" | "ipinfo", default ipqs).
 * This was a documented blocker in risk.ts - the hook existed but always
 * returned the not-configured stub. With a key present, risk.ts now
 * resolves a real adapter lazily; without one, behavior is unchanged and
 * the riskReason keeps recording 'ip-intel:unavailable' honestly.
 *
 * Privacy contract (inherited from risk.ts): the RAW ip is passed
 * transiently to the provider for this one lookup and never stored; only
 * the derived vpn/tor/asn/country results may be persisted.
 */

const IP_INTEL_TIMEOUT_MS = 5_000;

function key(): string | null {
  const value = process.env.IP_INTEL_API_KEY?.trim();
  return value && value.length > 0 ? value : null;
}

const NULL_INTEL: IpIntelResult = { vpn: null, tor: null, asn: null, country: null };

/** ipqualityscore.com - GET /api/json/ip/{key}/{ip}. */
export const ipqsProvider: IpIntelProvider = {
  name: "ipqs",
  get configured() {
    return !!key();
  },
  async lookup(rawIp: string): Promise<IpIntelResult> {
    const k = key();
    if (!k) return NULL_INTEL;
    const res = await fetch(
      `https://ipqualityscore.com/api/json/ip/${encodeURIComponent(k)}/${encodeURIComponent(rawIp)}`,
      { signal: AbortSignal.timeout(IP_INTEL_TIMEOUT_MS) },
    );
    if (!res.ok) throw new Error(`ipqs responded ${res.status}`);
    const raw = (await res.json()) as {
      success?: boolean;
      vpn?: boolean;
      tor?: boolean;
      ASN?: number | string;
      country_code?: string;
    };
    if (raw.success === false) throw new Error("ipqs lookup unsuccessful");
    return {
      vpn: typeof raw.vpn === "boolean" ? raw.vpn : null,
      tor: typeof raw.tor === "boolean" ? raw.tor : null,
      asn: raw.ASN !== undefined && raw.ASN !== null ? String(raw.ASN) : null,
      country: typeof raw.country_code === "string" ? raw.country_code : null,
    };
  },
};

/**
 * ipinfo.io - GET /{ip}?token={key}. The privacy block (vpn/tor) is a paid
 * add-on: absent fields stay null (a missing entitlement must not read as
 * "not a VPN").
 */
export const ipinfoProvider: IpIntelProvider = {
  name: "ipinfo",
  get configured() {
    return !!key();
  },
  async lookup(rawIp: string): Promise<IpIntelResult> {
    const k = key();
    if (!k) return NULL_INTEL;
    const res = await fetch(
      `https://ipinfo.io/${encodeURIComponent(rawIp)}?token=${encodeURIComponent(k)}`,
      { signal: AbortSignal.timeout(IP_INTEL_TIMEOUT_MS) },
    );
    if (!res.ok) throw new Error(`ipinfo responded ${res.status}`);
    const raw = (await res.json()) as {
      privacy?: { vpn?: boolean; tor?: boolean };
      org?: string;
      country?: string;
    };
    const asnMatch = typeof raw.org === "string" ? raw.org.match(/^(AS\d+)/) : null;
    return {
      vpn: typeof raw.privacy?.vpn === "boolean" ? raw.privacy.vpn : null,
      tor: typeof raw.privacy?.tor === "boolean" ? raw.privacy.tor : null,
      asn: asnMatch ? asnMatch[1] : null,
      country: typeof raw.country === "string" ? raw.country : null,
    };
  },
};

/**
 * Resolve the env-selected adapter, or null when no key is present (the
 * caller keeps the honest not-configured stub).
 */
export function buildIpIntelProviderFromEnv(): IpIntelProvider | null {
  if (!key()) return null;
  const which = process.env.IP_INTEL_PROVIDER?.trim().toLowerCase() || "ipqs";
  if (which === "ipinfo") return ipinfoProvider;
  if (which === "ipqs") return ipqsProvider;
  console.warn(`[auth:ip-intel] unknown IP_INTEL_PROVIDER "${which}" - ip intel stays off`);
  return null;
}
