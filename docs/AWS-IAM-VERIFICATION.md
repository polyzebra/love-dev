# AWS IAM — Least Privilege for Face Verification (Phase 22/31)

Two SEPARATE credential pairs. The runtime path can NEVER administer
collections; the ops/admin path is used only by the CLI/emergency purge.

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
