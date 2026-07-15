import { createHash, createHmac } from "node:crypto";

/**
 * AWS STS AssumeRole - browser streaming credentials for Face Liveness
 * (FaceLivenessDetectorCore), NO Cognito. Supabase remains the only
 * authentication provider; this issues SHORT-LIVED, minimally-scoped AWS
 * credentials for the direct browser->Rekognition streaming WebSocket
 * only.
 *
 * Fetch-based SigV4, no AWS SDK (house pattern, mirrors aws-rekognition.ts).
 * The RUNTIME credential signs the AssumeRole call; the assumed role
 * (FACE_LIVENESS_ROLE_ARN) is scoped to ONLY
 * rekognition:StartFaceLivenessSession - so the credentials handed to the
 * browser can start a liveness stream and nothing else (no IndexFaces /
 * SearchFaces / DeleteFaces / collection admin). Runtime stays
 * least-privileged: it gains a single sts:AssumeRole on that one role ARN.
 *
 * NEVER logged: the returned secret/session token, the role ARN details,
 * or any credential material. This module contains no logging.
 */

export type StreamingCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  /** ISO expiration - the credentialProvider is called once with no
   *  refresh, so the TTL must cover the whole capture (minutes). */
  expiration: string;
};

export function livenessStreamingConfig() {
  return {
    region: process.env.AWS_REKOGNITION_REGION?.trim() || "eu-west-1",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim(),
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY?.trim(),
    roleArn: process.env.FACE_LIVENESS_ROLE_ARN?.trim(),
    ttlSeconds: Number(process.env.FACE_LIVENESS_STS_TTL_SECONDS) || 900,
  };
}

export function livenessStreamingConfigured(): boolean {
  const c = livenessStreamingConfig();
  return Boolean(c.accessKeyId && c.secretAccessKey && c.roleArn);
}

/** Injectable transport for tests: (params) -> raw STS XML response. */
export type StsTransport = (params: Record<string, string>) => Promise<string>;
let stsTransportOverride: StsTransport | null = null;
export function setStsTransport(fn: StsTransport | null): void {
  stsTransportOverride = fn;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}
function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/** Minimal SigV4 for the STS query protocol (regional endpoint). */
function signSts(
  params: Record<string, string>,
  now: Date,
): { url: string; headers: Record<string, string>; body: string } {
  const cfg = livenessStreamingConfig();
  const region = cfg.region;
  const host = `sts.${region}.amazonaws.com`;
  const body = new URLSearchParams(params).toString();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const canonicalHeaders =
    `content-type:application/x-www-form-urlencoded; charset=utf-8\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-date";
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, payloadHash].join(
    "\n",
  );
  const scope = `${dateStamp}/${region}/sts/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kSigning = hmac(hmac(hmac(kDate, region), "sts"), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  return {
    url: `https://${host}/`,
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=utf-8",
      "x-amz-date": amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  };
}

function extract(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? m[1].trim() : null;
}

/**
 * Assume the liveness-streaming role and return short-lived credentials.
 * roleSessionName is a hash of the caller (no PII, <=64 chars, AWS-safe).
 */
export async function assumeLivenessStreamingRole(
  callerRef: string,
): Promise<StreamingCredentials | null> {
  const cfg = livenessStreamingConfig();
  if (!livenessStreamingConfigured()) return null;
  const roleSessionName = `tirvea-live-${sha256Hex(callerRef).slice(0, 16)}`;
  const params: Record<string, string> = {
    Action: "AssumeRole",
    Version: "2011-06-15",
    RoleArn: cfg.roleArn!,
    RoleSessionName: roleSessionName,
    DurationSeconds: String(Math.max(900, Math.min(3600, cfg.ttlSeconds))),
  };

  let xml: string;
  try {
    if (stsTransportOverride) {
      xml = await stsTransportOverride(params);
    } else {
      const signed = signSts(params, new Date());
      const res = await fetch(signed.url, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
        signal: AbortSignal.timeout(8000),
      });
      xml = await res.text();
      if (!res.ok) return null;
    }
  } catch {
    return null;
  }

  const accessKeyId = extract(xml, "AccessKeyId");
  const secretAccessKey = extract(xml, "SecretAccessKey");
  const sessionToken = extract(xml, "SessionToken");
  const expiration = extract(xml, "Expiration");
  if (!accessKeyId || !secretAccessKey || !sessionToken || !expiration) return null;
  return { accessKeyId, secretAccessKey, sessionToken, expiration };
}
