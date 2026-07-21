#!/usr/bin/env node
/**
 * CI production approval-status gate for AWS Face Liveness.
 *
 * Run before a production deploy. It is a DEPLOY-TIME check that moves the
 * approval verification into the pipeline WITHOUT weakening the runtime gate
 * (faceMatchLegalGate stays exactly as-is). It fails the deploy when the layer
 * is being turned on (FACE_MATCH_PROVIDER=aws_rekognition_faces) but the
 * required compliance documentation is absent or the legal/AWS config is
 * incomplete. When the layer is off, it passes (dormant is always deployable).
 *
 * It reads only file existence + non-secret env presence. It prints no secret
 * values. Exit 0 = OK to deploy · 1 = blocked (prints the exact reasons).
 */
import { existsSync } from "node:fs";

const REQUIRED_DOCS = [
  "docs/DPIA-FACE-VERIFICATION.md",
  "docs/L5.1-BIOMETRIC-INFORMATION-POLICY-DRAFT.md",
  "docs/L5.2-PHOTO-VERIFICATION-POLICY-DRAFT.md",
  "docs/FACE-CALIBRATION.md",
  "docs/FACE-EMERGENCY-ROLLBACK.md",
];

const LEGAL_ENV = [
  "FACE_LEGAL_APPROVED_VERSIONS",
  "FACE_LEGAL_APPROVAL_VERSION",
  "FACE_AWS_DPA_CONFIRMED",
  "FACE_CALIBRATION_APPROVED",
  "FACE_CALIBRATION_VERSION",
];
const AWS_ENV = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "FACE_LIVENESS_ROLE_ARN",
  "FACE_COLLECTION_ID",
];

const problems = [];

// 1) Required compliance docs must exist in the repo.
for (const d of REQUIRED_DOCS) {
  if (!existsSync(d)) problems.push(`missing required document: ${d}`);
}

const enablingAws =
  (process.env.FACE_MATCH_PROVIDER ?? "").trim().toLowerCase() === "aws_rekognition_faces";

if (enablingAws) {
  // 2) Legal/compliance approval env must be present + internally consistent.
  const approved = (process.env.FACE_LEGAL_APPROVED_VERSIONS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const supplied = (process.env.FACE_LEGAL_APPROVAL_VERSION ?? "").trim();
  for (const k of LEGAL_ENV) {
    if (!(process.env[k] ?? "").trim()) problems.push(`AWS enabled but ${k} is unset`);
  }
  if (process.env.FACE_AWS_DPA_CONFIRMED?.trim() && process.env.FACE_AWS_DPA_CONFIRMED !== "1")
    problems.push("FACE_AWS_DPA_CONFIRMED must be exactly 1");
  if (
    process.env.FACE_CALIBRATION_APPROVED?.trim() &&
    process.env.FACE_CALIBRATION_APPROVED !== "1"
  )
    problems.push("FACE_CALIBRATION_APPROVED must be exactly 1");
  if (approved.length && supplied && !approved.includes(supplied))
    problems.push("FACE_LEGAL_APPROVAL_VERSION is not a member of FACE_LEGAL_APPROVED_VERSIONS");
  if (process.env.FACE_EMERGENCY_DISABLE === "1")
    problems.push("FACE_EMERGENCY_DISABLE is engaged (kill switch on)");
  // 3) AWS runtime config must be present.
  for (const k of AWS_ENV) {
    if (!(process.env[k] ?? "").trim()) problems.push(`AWS enabled but ${k} is unset`);
  }
}

if (problems.length) {
  console.error("FACE READINESS: BLOCKED\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log(
  enablingAws
    ? "FACE READINESS: OK — AWS enabling, docs present, legal + AWS config complete."
    : "FACE READINESS: OK — AWS provider dormant (nothing to gate).",
);
process.exit(0);
