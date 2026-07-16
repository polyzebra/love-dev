import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { FileX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatAgo } from "@/lib/utils";
import { requireAdminPage } from "@/lib/auth/require-user";
import { hasPermission } from "@/lib/rbac";
import { BindingReviewForm } from "./binding-review-form";

export const metadata: Metadata = { title: "Binding review" };
export const dynamic = "force-dynamic";

function maskRef(externalFaceId: string | null | undefined): string {
  if (!externalFaceId) return "—";
  return `ref-…${externalFaceId.slice(-4)}`;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export default async function BindingReviewDetail({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminPage("staff");
  if (!admin || !hasPermission(admin.role, "safety:manage")) return null;
  const { id } = await params;

  const binding = await db.faceIdentityBinding.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      status: true,
      method: true,
      createdAt: true,
      identitySessionId: true,
      livenessFlowId: true,
      faceReferenceId: true,
      reviewReasonCode: true,
      reviewedAt: true,
    },
  });
  if (!binding) {
    return (
      <EmptyState icon={FileX} title="Not found" description="This binding no longer exists." />
    );
  }

  const [user, job, identity, ref, attempts, liveness] = await Promise.all([
    db.user.findUnique({
      where: { id: binding.userId },
      select: { email: true, photoVerifiedAt: true },
    }),
    db.profilePhotoVerification.findUnique({
      where: { userId: binding.userId },
      select: { consentVersion: true, consentAt: true, referenceStatus: true, status: true },
    }),
    db.verification.findFirst({
      where: { userId: binding.userId, type: { in: ["PHOTO", "IDENTITY"] } },
      orderBy: { updatedAt: "desc" },
      select: { status: true, providerSessionId: true },
    }),
    binding.faceReferenceId
      ? db.faceReferenceRecord.findUnique({
          where: { id: binding.faceReferenceId },
          select: { status: true, referenceVersion: true, externalFaceId: true },
        })
      : Promise.resolve(null),
    db.faceIdentityBinding.findMany({
      where: { userId: binding.userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, status: true, createdAt: true, reviewReasonCode: true },
    }),
    db.livenessSession.findFirst({
      where: { userId: binding.userId },
      orderBy: { createdAt: "desc" },
      select: { status: true, consumedAt: true, createdAt: true },
    }),
  ]);

  const stripeLink = identity?.providerSessionId
    ? `https://dashboard.stripe.com/identity/verification-sessions/${identity.providerSessionId}`
    : null;
  const consentActive = Boolean(job?.consentAt) && Boolean(job?.consentVersion);
  const reviewable = binding.status === "MANUAL_REVIEW";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Binding review"
        description="Is the person in the Tirvea liveness evidence the same person who completed identity verification?"
      />
      <Link href="/admin/verification/bindings" className="text-muted-foreground text-sm underline">
        ← Back to queue
      </Link>

      <Card>
        <CardContent className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium">{user?.email ?? binding.userId}</span>
            <Badge variant="outline">{binding.status}</Badge>
          </div>
          <Row label="Binding method" value={binding.method} />
          <Row label="Identity verification" value={identity?.status ?? "—"} />
          <Row
            label="Stripe evidence"
            value={
              stripeLink ? (
                <a
                  href={stripeLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  Open in Stripe Dashboard ↗
                </a>
              ) : (
                "session id unavailable"
              )
            }
          />
          <Row
            label="Liveness flow"
            value={binding.livenessFlowId ? `flow-…${binding.livenessFlowId.slice(-6)}` : "—"}
          />
          <Row label="Liveness status" value={liveness?.status ?? "—"} />
          <Row
            label="Liveness completed"
            value={liveness?.consumedAt ? formatAgo(liveness.consumedAt) : "—"}
          />
          <Row label="Reference status" value={ref?.status ?? job?.referenceStatus ?? "—"} />
          <Row label="Reference (masked)" value={maskRef(ref?.externalFaceId)} />
          <Row
            label="Consent"
            value={consentActive ? `active (${job?.consentVersion})` : "not active"}
          />
          <Row label="Requested" value={formatAgo(binding.createdAt)} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-3 font-medium">Decision</h2>
          <div className="mb-4 space-y-1 rounded-md bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <p>1. Confirm identity is still verified and consent is still active (above).</p>
            <p>2. Open the Stripe Dashboard evidence and view the Tirvea liveness capture.</p>
            <p>
              3. Decide only whether it is the SAME PERSON. Do not judge the profile photos here.
            </p>
          </div>
          <BindingReviewForm bindingId={binding.id} disabled={!reviewable} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-2 text-sm font-medium">Attempt history</h2>
          <div className="space-y-1 text-xs">
            {attempts.map((a) => (
              <div key={a.id} className="text-muted-foreground flex justify-between">
                <span>
                  {a.status}
                  {a.reviewReasonCode ? ` (${a.reviewReasonCode})` : ""}
                </span>
                <span>{formatAgo(a.createdAt)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
