# AWS IAM — Least Privilege for Face Verification (Phase 22/31)

Two SEPARATE credential pairs. The runtime path can NEVER administer
collections; the ops/admin path is used only by the CLI/emergency purge.

> **Lifecycle state:** these policies are what "configured" (state 2) needs
> on the AWS side. Having them attached does **not** make the layer legally
> approved (state 3) or rolled out (state 6) - see the status board in
> FACE-VERIFICATION-RUNBOOK.md. The `<ACCOUNT_ID>`, `<COLLECTION_ID>`, and
> `eu-west-1` below are placeholders: the region MUST equal both
> `AWS_REGION` and `AWS_REKOGNITION_REGION` (a mismatch trips the
> `region_mismatch` alert - see FACE-ALERTING.md), and the collection MUST
> equal `FACE_COLLECTION_ID` (a distinct collection per environment).
>
> `ListFaces` is used by two safe paths: the read-only `face:preflight`
> check (`ListFaces` MaxResults=1) and the idempotency probe before
> `IndexFaces`. `DetectFaces` is listed for completeness (quality/detection
> during enrol); if CloudTrail shows it unused for your account you may drop
> it without affecting the compare/enrol paths.

## Runtime credential (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "FaceLiveness",
      "Effect": "Allow",
      "Action": [
        "rekognition:CreateFaceLivenessSession",
        "rekognition:GetFaceLivenessSessionResults"
      ],
      "Resource": "*"
    },
    {
      "Sid": "FaceCollectionRuntime",
      "Effect": "Allow",
      "Action": [
        "rekognition:IndexFaces",
        "rekognition:SearchFacesByImage",
        "rekognition:SearchFaces",
        "rekognition:DeleteFaces",
        "rekognition:ListFaces",
        "rekognition:DetectFaces"
      ],
      "Resource": "arn:aws:rekognition:eu-west-1:<ACCOUNT_ID>:collection/<COLLECTION_ID>"
    },
    {
      "Sid": "RegionLock",
      "Effect": "Deny",
      "NotAction": "rekognition:*",
      "Resource": "*",
      "Condition": { "StringNotEquals": { "aws:RequestedRegion": "eu-west-1" } }
    }
  ]
}
```

NOT granted at runtime: `CreateCollection`, `DeleteCollection`,
`DescribeCollection`. Collection administration is impossible with this
credential — the `purgeAllReferences()` path refuses without the admin
pair.

Runtime ALSO gets a single narrowly-scoped `sts:AssumeRole` for the
browser streaming role (below) — nothing wider:

```json
{
  "Sid": "AssumeLivenessStreamingRole",
  "Effect": "Allow",
  "Action": "sts:AssumeRole",
  "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/TirveaFaceLivenessStreaming"
}
```

## Browser streaming role — `TirveaFaceLivenessStreaming` (NO Cognito)

The AWS Face Liveness capture streams video directly from the browser to
Rekognition (`StartFaceLivenessSession`), which needs temporary AWS
credentials client-side. We mint them via **STS AssumeRole** (not a
Cognito Identity Pool). Supabase remains the only auth provider; these
AWS credentials are server-minted, per-capture, short-lived (<=15 min),
and issued only to the authenticated flow owner. The role grants EXACTLY
one action:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LivenessStreamingOnly",
      "Effect": "Allow",
      "Action": "rekognition:StartFaceLivenessSession",
      "Resource": "*",
      "Condition": { "StringEquals": { "aws:RequestedRegion": "eu-west-1" } }
    }
  ]
}
```

Trust policy (only the runtime principal may assume it):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::<ACCOUNT_ID>:user/tirvea-face-services" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

The credentials handed to the browser can therefore ONLY start a liveness
stream — never `IndexFaces` / `SearchFaces` / `DeleteFaces` / collection
admin. Env: `FACE_LIVENESS_ROLE_ARN`, `FACE_LIVENESS_STS_TTL_SECONDS`.

## Admin credential (`AWS_ADMIN_ACCESS_KEY_ID` / `AWS_ADMIN_SECRET_ACCESS_KEY`)

Used only by the ops CLI (collection create/validate, emergency purge).
Not present in the app runtime environment.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "FaceCollectionAdmin",
      "Effect": "Allow",
      "Action": [
        "rekognition:CreateCollection",
        "rekognition:DeleteCollection",
        "rekognition:DescribeCollection"
      ],
      "Resource": "arn:aws:rekognition:eu-west-1:<ACCOUNT_ID>:collection/<COLLECTION_ID>"
    }
  ]
}
```

## Permission-to-operation map

| Operation                  | IAM action                                           | Credential |
| -------------------------- | ---------------------------------------------------- | ---------- |
| Liveness session create    | CreateFaceLivenessSession                            | runtime    |
| Liveness result            | GetFaceLivenessSessionResults                        | runtime    |
| Face indexing (enrol)      | IndexFaces                                           | runtime    |
| Face searching (compare)   | SearchFacesByImage                                   | runtime    |
| Face searching (duplicate) | SearchFaces                                          | runtime    |
| Face deletion              | DeleteFaces                                          | runtime    |
| Collection admin           | CreateCollection/DeleteCollection/DescribeCollection | ADMIN only |

## Environment isolation (Phase 31)

- Separate collection per environment (`FACE_COLLECTION_ID` = e.g.
  `tirvea-staging` vs `tirvea-prod`) — staging references can never
  appear in production searches.
- Region enforced in-adapter (`AWS_ALLOWED_REGIONS`, default eu-west-1);
  a mis-set region is refused, not silently used.
- Secret rotation: rotate both key pairs quarterly and on any
  personnel/vendor event; the resilience layer classifies credential
  failures and (unlike transient errors) does not retry them.
