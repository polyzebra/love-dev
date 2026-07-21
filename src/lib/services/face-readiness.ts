import {
  getFaceMatchProvider,
  isFaceMatchConfigured,
} from "@/lib/services/face-match-providers";
import {
  faceMatchLegalGate,
  faceEmergencyDisabled,
  faceRolloutConfig,
  faceEnvironment,
} from "@/lib/services/face-rollout";
import { livenessStreamingConfigured } from "@/lib/services/aws-sts";

/**
 * READ-ONLY production readiness snapshot for the AWS Face Liveness layer.
 *
 * SAFE TO EXPOSE (admin surface + logs): booleans, the provider identifier, the
 * region name, the rollout percent, and the legal gate's list of NON-SECRET env
 * key NAMES that are still missing. It NEVER returns secret VALUES (no AWS keys,
 * no STS tokens, no role ARN value, no collection id, no raw env values), and it
 * never touches biometric data. It does NOT change any runtime behaviour - it
 * only reports what the canonical resolvers already decide.
 */
export type FaceReadiness = {
  /** Provider identifier only (e.g. "aws_rekognition_faces" | not-configured). */
  provider: string;
  /** getFaceMatchProvider() resolves to a real provider in this runtime. */
  isFaceMatchConfigured: boolean;
  /** FACE_LIVENESS_ENABLED=1. */
  livenessEnabled: boolean;
  /** STS creds + role present (livenessStreamingConfigured). */
  streamingConfigured: boolean;
  /** FACE_COLLECTION_ID is set (presence only, never the value). */
  collectionConfigured: boolean;
  /** Region NAME (not a secret). */
  region: string;
  /** Emergency kill switch engaged. */
  killSwitchActive: boolean;
  /** Compliance gate result: ok + the NON-SECRET env key names still missing. */
  legalGate: { ok: boolean; missing: string[] };
  /** Progressive-rollout cohort percent (0-100). */
  rolloutPercent: number;
  /** "production" | "staging". */
  environment: string;
  /** All technical prerequisites resolve true (still gated by legalGate in prod). */
  deployReady: boolean;
};

export function getFaceReadiness(): FaceReadiness {
  const rollout = faceRolloutConfig();
  const legal = faceMatchLegalGate();
  const configured = isFaceMatchConfigured();
  const streaming = livenessStreamingConfigured();
  const killSwitch = faceEmergencyDisabled();
  return {
    provider: getFaceMatchProvider().name,
    isFaceMatchConfigured: configured,
    livenessEnabled: rollout.livenessEnabled,
    streamingConfigured: streaming,
    collectionConfigured: Boolean(process.env.FACE_COLLECTION_ID?.trim()),
    region: process.env.AWS_REKOGNITION_REGION?.trim() || "eu-west-1",
    killSwitchActive: killSwitch,
    legalGate: { ok: legal.ok, missing: legal.missing },
    rolloutPercent: rollout.percent,
    environment: faceEnvironment(),
    deployReady: configured && rollout.livenessEnabled && streaming && !killSwitch,
  };
}
