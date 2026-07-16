/**
 * face:preflight - non-destructive, server-only readiness check for the AWS
 * face-verification layer. Verifies configuration + IAM WITHOUT processing
 * any user image and WITHOUT enabling production.
 *
 *   npm run face:preflight            human-readable table
 *   npm run face:preflight -- --json  machine-readable JSON only
 *   npm run face:preflight -- --require-legal
 *                                     also FAIL if the legal-approval gate is
 *                                     unsatisfied (default: report only)
 *
 * It NEVER: prints credentials, indexes a real face, compares a real user,
 * modifies a user, or enables the provider. The only live AWS call is one
 * read-only ListFaces(MaxResults=1) - the smallest safe op that proves
 * credentials + region + collection + runtime IAM in one shot. WRITE-path
 * permissions (IndexFaces/CompareFaces) cannot be proven without processing
 * an image, so they are explicitly out of scope here and belong to the
 * separately-authorized staging rehearsal.
 *
 * Exit code: non-zero iff any FAIL (WARN never fails the command).
 */
import "dotenv/config";

type Status = "PASS" | "WARN" | "FAIL";
type Check = { id: string; title: string; status: Status; detail: string };

const argv = process.argv.slice(2);
const JSON_ONLY = argv.includes("--json");
const REQUIRE_LEGAL =
  argv.includes("--require-legal") || process.env.FACE_PREFLIGHT_REQUIRE_LEGAL === "1";

/** AWS error TYPEs that mean a real, blocking misconfiguration. */
function isBlockingAwsError(errorType: string): boolean {
  return /AccessDenied|ResourceNotFound|InvalidSignature|UnrecognizedClient|not in the approved|disagrees|credentials are not set|AuthFailure|ExpiredToken/i.test(
    errorType,
  );
}

async function main() {
  const checks: Check[] = [];
  const add = (id: string, title: string, status: Status, detail: string) =>
    checks.push({ id, title, status, detail });

  const [{ faceRolloutConfig, faceInternalAllowlist }, rek] = await Promise.all([
    import("../src/lib/services/face-rollout"),
    import("../src/lib/services/aws-rekognition"),
  ]);
  const cfg = faceRolloutConfig();
  const aws = rek.awsConfig();
  const providerSel = process.env.FACE_MATCH_PROVIDER?.trim().toLowerCase() || "(unset)";
  const isProd = process.env.NODE_ENV === "production";

  // 1. Provider selection (dormant is a valid, expected state).
  if (providerSel === "aws_rekognition_faces") {
    add("provider_selection", "FACE_MATCH_PROVIDER", "PASS", "aws_rekognition_faces selected");
  } else if (providerSel === "mock") {
    add("provider_selection", "FACE_MATCH_PROVIDER", "WARN", "mock (dev tooling; dormant in prod)");
  } else {
    add("provider_selection", "FACE_MATCH_PROVIDER", "WARN", `dormant (${providerSel})`);
  }

  // 2. Legal approval - only ASSERTED when explicitly requested.
  const legalSet = Boolean(cfg.legalApprovalVersion);
  if (REQUIRE_LEGAL) {
    if (legalSet)
      add("legal_approval", "FACE_LEGAL_APPROVAL_VERSION", "PASS", "recorded (required check)");
    else
      add(
        "legal_approval",
        "FACE_LEGAL_APPROVAL_VERSION",
        "FAIL",
        "required but not set - biometric processing must not be enabled",
      );
  } else {
    add(
      "legal_approval",
      "FACE_LEGAL_APPROVAL_VERSION",
      legalSet ? "PASS" : "WARN",
      legalSet ? "recorded" : "not set (report-only; pass --require-legal to enforce)",
    );
  }

  // 3. AWS credentials resolve (presence ONLY - never printed).
  const credsResolved = Boolean(aws.accessKeyId && aws.secretAccessKey);
  add(
    "aws_credentials",
    "AWS credentials",
    credsResolved ? "PASS" : "FAIL",
    credsResolved
      ? "resolved (values not shown)"
      : "AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY missing",
  );

  // 4. Region equality: AWS_REGION must equal AWS_REKOGNITION_REGION.
  const globalRegion = process.env.AWS_REGION?.trim();
  if (!globalRegion) {
    add(
      "region_equality",
      "AWS_REGION == AWS_REKOGNITION_REGION",
      "WARN",
      `AWS_REGION unset; rekognition region=${aws.region}`,
    );
  } else if (globalRegion === aws.region) {
    add("region_equality", "AWS_REGION == AWS_REKOGNITION_REGION", "PASS", `both ${aws.region}`);
  } else {
    add(
      "region_equality",
      "AWS_REGION == AWS_REKOGNITION_REGION",
      "FAIL",
      `AWS_REGION=${globalRegion} != AWS_REKOGNITION_REGION=${aws.region}`,
    );
  }

  // 5. Region in the approved allowlist.
  add(
    "region_allowlist",
    "region in AWS_ALLOWED_REGIONS",
    aws.allowedRegions.includes(aws.region) ? "PASS" : "FAIL",
    `region=${aws.region}; allowed=[${aws.allowedRegions.join(", ")}]`,
  );

  // 6. Collection id present (value masked - resource id, not printed in full).
  add(
    "collection_id",
    "FACE_COLLECTION_ID",
    aws.collectionId ? "PASS" : "FAIL",
    aws.collectionId ? "set" : "missing",
  );

  // 7. Live IAM + collection existence via ONE read-only ListFaces.
  if (rek.awsRekognitionConfigured()) {
    const r = await rek.rekognitionReadPreflight();
    if (r.ok) {
      add(
        "iam_read_access",
        "IAM read/list (ListFaces)",
        "PASS",
        `collection reachable; model=${r.faceModelVersion ?? "?"}`,
      );
    } else if (isBlockingAwsError(r.errorType)) {
      add("iam_read_access", "IAM read/list (ListFaces)", "FAIL", r.errorType);
    } else {
      add("iam_read_access", "IAM read/list (ListFaces)", "WARN", `inconclusive: ${r.errorType}`);
    }
  } else {
    add(
      "iam_read_access",
      "IAM read/list (ListFaces)",
      "WARN",
      "skipped - creds/collection not fully configured (no live call)",
    );
  }
  add(
    "iam_write_access",
    "IAM write path (IndexFaces/CompareFaces)",
    "WARN",
    "not verifiable without processing an image - covered by the authorized staging rehearsal, not this preflight",
  );

  // 8. Cron secret (recovery sweep auth).
  add(
    "cron_secret",
    "CRON_SECRET",
    process.env.CRON_SECRET?.trim() ? "PASS" : "WARN",
    process.env.CRON_SECRET?.trim()
      ? "set"
      : "not set (required for the /api/cron/face-checks sweep)",
  );

  // 9. Threshold (calibration) version.
  add(
    "threshold_version",
    "FACE_CALIBRATION_VERSION",
    cfg.calibrationVersion ? "PASS" : "WARN",
    cfg.calibrationVersion
      ? cfg.calibrationVersion
      : 'unset - checks fall back to "v0" (set an explicit version before rollout)',
  );

  // 10. Emergency-disable behavior visible.
  const emergency = process.env.FACE_EMERGENCY_DISABLE === "1";
  add(
    "emergency_disable",
    "FACE_EMERGENCY_DISABLE",
    "PASS",
    emergency
      ? "ON - admission is BLOCKED for everyone (instant kill switch active)"
      : "off (would instantly block all admission when set to 1)",
  );

  // 11. Rollout percent + allowlists parse correctly.
  const rawPercent = process.env.FACE_VERIFICATION_PERCENT;
  const percentValid = rawPercent === undefined || Number.isFinite(Number(rawPercent));
  const internalCount = faceInternalAllowlist().size;
  add(
    "rollout_parse",
    "rollout percent + allowlists",
    percentValid ? "PASS" : "WARN",
    `percent=${cfg.percent}${rawPercent === undefined ? " (default)" : ""}; countries=[${cfg.countryAllowlist.join(", ") || "all"}]; internal_ids=${internalCount}`,
  );

  // ---- results ----------------------------------------------------------
  const overall: Status = checks.some((c) => c.status === "FAIL")
    ? "FAIL"
    : checks.some((c) => c.status === "WARN")
      ? "WARN"
      : "PASS";

  if (JSON_ONLY) {
    process.stdout.write(
      JSON.stringify(
        { overall, environment: isProd ? "production" : "non-production", checks },
        null,
        2,
      ) + "\n",
    );
  } else {
    const mark = { PASS: "✓ PASS", WARN: "! WARN", FAIL: "✗ FAIL" } as const;
    console.log(`\nFace verification preflight  (${isProd ? "production" : "non-production"})\n`);
    for (const c of checks)
      console.log(`  ${mark[c.status].padEnd(7)} ${c.title.padEnd(42)} ${c.detail}`);
    const fails = checks.filter((c) => c.status === "FAIL").length;
    const warns = checks.filter((c) => c.status === "WARN").length;
    console.log(`\n  OVERALL: ${mark[overall]}   (${fails} fail, ${warns} warn)\n`);
    if (fails) {
      console.log("  Blocking failures:");
      for (const c of checks.filter((x) => x.status === "FAIL"))
        console.log(`    - ${c.id}: ${c.detail}`);
      console.log("");
    }
    console.log(
      "  Note: this is read-only. It does not index/compare any face, modify any user, or enable the provider.\n",
    );
  }

  process.exit(overall === "FAIL" ? 1 : 0);
}

main().catch((error) => {
  console.error(`face:preflight crashed: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
});
