import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck, CircleDashed } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/auth/require-user";
import { isAuthUserAlive } from "@/lib/auth/identity";
import { hasPermission } from "@/lib/rbac";
import { countryByIso } from "@/lib/auth/countries";
import { maskPhone } from "@/lib/phone-mask";
import { computeScamScore } from "@/lib/services/scam";
import { toVerificationState } from "@/lib/services/verification";
import { formatAgo } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ACCOUNT_STATUS_BADGE,
  APPEAL_STATUS_BADGE,
  CASE_STATUS_BADGE,
  ENFORCEMENT_BADGE,
  PHONE_SYNC_BADGE,
  SEVERITY_BADGE,
  VERIFICATION_STATUS_BADGE,
  pretty,
  shortId,
} from "../../safety-badges";
import { TrustActions } from "./trust-actions";
import { SafetyActions } from "./safety-actions";

export const metadata: Metadata = { title: "User detail" };
export const dynamic = "force-dynamic";

/** Salted hashes are long - show enough to compare, never pretend it's an IP. */
function shortHash(hash: string | null): string {
  return hash ? `${hash.slice(0, 12)}…` : "-";
}

function stampDate(date: Date | null): string {
  return date ? formatAgo(date) : "-";
}

function VerifiedStamp({ verifiedAt, label }: { verifiedAt: Date | null; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-sm">
      {verifiedAt ? (
        <BadgeCheck className="text-success size-4 shrink-0" aria-hidden="true" />
      ) : (
        <CircleDashed className="text-muted-foreground/40 size-4 shrink-0" aria-hidden="true" />
      )}
      <span className={verifiedAt ? "" : "text-muted-foreground"}>
        {label}
        {verifiedAt ? ` · ${formatAgo(verifiedAt)}` : ""}
      </span>
    </span>
  );
}

/** auth.users.phone mirror disposition - "-" when no verified phone. */
function PhoneSyncBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">sync -</span>;
  return (
    <Badge variant={PHONE_SYNC_BADGE[status] ?? "outline"} className="rounded-full">
      sync {status.toLowerCase()}
    </Badge>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card rounded-3xl border p-5">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Pages gate themselves ON TOP of the layout (see requireAdminPage).
  // The admin layout admits MODERATOR too - the raw E.164 below is
  // revealed to identity-managing roles only (ADMIN/SUPER_ADMIN via rbac
  // users:manage), everyone else gets the masked form.
  const viewer = await requireAdminPage();
  if (!viewer) return null;
  const viewerIsAdmin = hasPermission(viewer.role, "users:manage");

  const user = await db.user.findUnique({
    where: { id },
    include: {
      profile: { select: { displayName: true, city: true, country: true } },
      devices: { orderBy: { lastSeenAt: "desc" } },
      verifications: { orderBy: { updatedAt: "desc" } },
      subscription: { select: { tier: true } },
      _count: { select: { reportsReceived: true } },
    },
  });
  if (!user) notFound();

  // Canonical verification verdicts - same accessor as the profile hero
  // and the member-facing account page (full row satisfies the source shape).
  const verification = toVerificationState(user);

  // Scam score is recomputed lazily on page load - always fresh, always
  // derived from real persisted signals. Failure renders "-", never a guess.
  let scam: Awaited<ReturnType<typeof computeScamScore>> | null = null;
  try {
    scam = await computeScamScore(user.id);
  } catch {
    scam = null;
  }

  // Trust & safety records: enforcement history + open cases for the panel.
  const [violations, moderationCases] = await Promise.all([
    db.accountViolation.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        actionTaken: true,
        violationType: true,
        createdAt: true,
        expiresAt: true,
        reversedAt: true,
        moderationCaseId: true,
        appeals: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true },
        },
      },
    }),
    db.moderationCase.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, caseType: true, status: true, severity: true, createdAt: true },
    }),
  ]);

  const eventScope = { OR: [{ userId: user.id }, { email: user.email.toLowerCase() }] };
  const [events, otpSends, otpVerifyOk, otpFails, riskWarnings, emailBlock] = await Promise.all([
    db.authVerificationEvent.findMany({
      where: eventScope,
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.authVerificationEvent.count({ where: { ...eventScope, type: { contains: "otp_send" } } }),
    db.authVerificationEvent.count({
      where: { ...eventScope, type: { in: ["email_otp_verify", "phone_otp_verify"] } },
    }),
    db.authVerificationEvent.count({ where: { ...eventScope, type: "otp_verify_fail" } }),
    db.authVerificationEvent.count({ where: { ...eventScope, type: { startsWith: "risk_" } } }),
    db.blockedIdentity.findUnique({ where: { email: user.email.toLowerCase() } }),
  ]);

  const banned = Boolean(user.bannedAt) || user.status === "SUSPENDED";

  // "Release phone from deleted account" is offered to supers only, and
  // only when the holder is conclusively not alive: tombstoned, or its
  // auth.users identity is gone (dashboard deletion that left the app row
  // behind). isAuthUserAlive fails SAFE (alive), so the action never shows
  // for a live account on a flaky auth read.
  const viewerIsSuper = hasPermission(viewer.role, "phones:release");
  const holderNotAlive =
    viewerIsSuper &&
    Boolean(user.phoneE164) &&
    (user.status === "DELETED" || !(await isAuthUserAlive(user.id)));

  return (
    <>
      <Link
        href="/admin/users"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> All users
      </Link>

      <PageHeader
        className="flex-wrap"
        title={user.profile?.displayName ?? user.name ?? user.email}
        description={user.email}
        actions={
          <span className="text-muted-foreground font-mono text-xs" title={user.id}>
            id {shortId(user.id)}
          </span>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge variant={ACCOUNT_STATUS_BADGE[user.status] ?? "outline"} className="rounded-full">
          {pretty(user.status)}
        </Badge>
        {banned && (
          <Badge variant="destructive" className="rounded-full">
            banned {user.bannedAt ? formatAgo(user.bannedAt) : ""}
          </Badge>
        )}
        {emailBlock && (
          <Badge variant="outline" className="rounded-full">
            email on blocklist
          </Badge>
        )}
        <span className="text-muted-foreground text-sm">
          Plan {user.subscription?.tier ?? "FREE"}
        </span>
      </div>

      <TrustActions
        userId={user.id}
        banned={banned}
        hasPhone={Boolean(user.phoneE164 ?? user.phone)}
        phoneVerified={verification.phoneVerified}
        phoneSyncStatus={user.phoneSyncStatus}
        emailBlocked={Boolean(emailBlock)}
        onboardingDone={user.onboardingDone}
        canReleaseDeletedPhone={holderNotAlive}
      />

      {/* Safety enforcement (phase-1 safety routes: violations, notices,
          AdminLog). Rendered under the identity trust actions. */}
      <div className="mt-2">
        <SafetyActions userId={user.id} userStatus={user.status} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Section title="Identity">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Field label="Email">
              <span className="break-all">{user.email}</span>
              <VerifiedStamp
                verifiedAt={verification.emailVerifiedAt}
                label={verification.emailVerified ? "Verified" : "Unverified"}
              />
            </Field>
            <Field label="Phone">
              {(() => {
                const number = user.phoneE164 ?? user.phone;
                if (!number) return "-";
                const country = countryByIso(user.phoneCountryIso);
                return (
                  <>
                    <span>{maskPhone(number, user.phoneDialCode)}</span>
                    {/* Raw E.164: ADMIN eyes only - moderators get the mask. */}
                    {viewerIsAdmin && (
                      <span className="text-muted-foreground block font-mono text-xs">
                        {number}
                      </span>
                    )}
                    <span className="text-muted-foreground block text-xs">
                      {country?.name ?? "Unknown country"}
                      {user.phoneCountryIso ? ` (${user.phoneCountryIso})` : ""}
                      {user.phoneDialCode ? ` · ${user.phoneDialCode}` : ""}
                    </span>
                    <VerifiedStamp
                      verifiedAt={verification.phoneVerifiedAt}
                      label={verification.phoneVerified ? "Verified" : "Unverified"}
                    />
                    <span className="mt-1 block">
                      <PhoneSyncBadge status={user.phoneSyncStatus} />
                      {user.phoneSyncStatus === "FAILED" && user.phoneSyncErrorCode && (
                        <span className="text-muted-foreground ml-1.5 text-xs">
                          {user.phoneSyncErrorCode}
                        </span>
                      )}
                    </span>
                  </>
                );
              })()}
            </Field>
            {/* Dual-badge model (Epic 4): Identity Verified (Stripe) and Photo
                Verified (positive face grant) are SEPARATE signals - never
                conflate. Photo Verified is null for everyone until the full
                trust workflow completes. */}
            <Field label="Identity verified">
              <VerifiedStamp
                verifiedAt={verification.photoVerifiedAt}
                label={verification.photoVerified ? "Verified" : "Not verified"}
              />
              <span className="text-muted-foreground text-xs">
                Provider: {user.photoVerificationProvider ?? "-"}
              </span>
            </Field>
            <Field label="Photo verified (badge)">
              <VerifiedStamp
                verifiedAt={user.faceVerifiedAt}
                label={user.faceVerifiedAt ? "Verified" : "Not yet"}
              />
            </Field>
            <Field label="Country (last IP)">{user.lastIpCountry ?? "-"}</Field>
            <Field label="Created">{stampDate(user.createdAt)}</Field>
            <Field label="Last login">{stampDate(user.lastLoginAt)}</Field>
            <Field label="Onboarding">{user.onboardingDone ? "Completed" : "Not completed"}</Field>
            <Field label="Reports received">
              <span className="tabular-nums">{user._count.reportsReceived}</span>
            </Field>
          </dl>
        </Section>

        <Section title="Trust & risk">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Field label="Risk score">
              {/* riskUpdatedAt null = the engine never scored this account. */}
              <span className="tabular-nums">{user.riskUpdatedAt ? user.riskScore : "-"}</span>
            </Field>
            <Field label="Risk updated">{stampDate(user.riskUpdatedAt)}</Field>
            <Field label="Risk reason">{user.riskReason ?? "-"}</Field>
            <Field label="Scam score (live)">
              <span className="tabular-nums">{scam ? scam.score : "-"}</span>
              {scam && scam.reasons.length > 0 && (
                <span className="text-muted-foreground block text-xs">
                  {scam.reasons.join(", ")}
                </span>
              )}
            </Field>
            <Field label="Warnings">
              <span className="tabular-nums">{riskWarnings}</span> risk ·{" "}
              <span className="tabular-nums">{otpFails}</span> failed OTP
            </Field>
            <Field label="OTP attempts">
              <span className="tabular-nums">{otpSends}</span> sent ·{" "}
              <span className="tabular-nums">{otpVerifyOk}</span> verified ·{" "}
              <span className="tabular-nums">{otpFails}</span> failed
            </Field>
            <Field label="Ban state">
              {banned ? `Banned ${user.bannedAt ? formatAgo(user.bannedAt) : ""}` : "Not banned"}
            </Field>
            <Field label="Ban reason">{user.banReason ?? "-"}</Field>
          </dl>
        </Section>

        <Section title="Safety">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Field label="Safety risk score">
              <span className="tabular-nums">
                {user.safetyRiskUpdatedAt ? user.safetyRiskScore : "-"}
              </span>
              {user.safetyRiskUpdatedAt && (
                <span className="text-muted-foreground ml-1.5 text-xs">
                  updated {formatAgo(user.safetyRiskUpdatedAt)}
                </span>
              )}
            </Field>
            <Field label="Recommended action">
              {user.safetyRecommendedAction ? pretty(user.safetyRecommendedAction) : "-"}
            </Field>
            <Field label="Signals">
              {user.safetyRiskReasons ? (
                <span className="flex flex-wrap gap-1.5">
                  {user.safetyRiskReasons
                    .split(",")
                    .filter(Boolean)
                    .map((reason) => (
                      <span
                        key={reason}
                        className="bg-muted rounded-full px-2.5 py-0.5 text-xs font-medium"
                      >
                        {reason}
                      </span>
                    ))}
                </span>
              ) : (
                "-"
              )}
            </Field>
            <Field label="Open cases">
              <span className="tabular-nums">
                {
                  moderationCases.filter((c) => c.status === "OPEN" || c.status === "UNDER_REVIEW")
                    .length
                }
              </span>
            </Field>
          </dl>

          {violations.length > 0 && (
            <>
              <h3 className="text-muted-foreground mt-4 mb-1.5 text-xs font-medium tracking-wide uppercase">
                Violations
              </h3>
              <ul className="divide-y">
                {violations.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-2 py-2">
                    <Badge
                      variant={ENFORCEMENT_BADGE[v.actionTaken] ?? "outline"}
                      className="rounded-full"
                    >
                      {pretty(v.actionTaken)}
                    </Badge>
                    <span className="text-sm">{pretty(v.violationType)}</span>
                    {v.reversedAt && (
                      <Badge variant="outline" className="rounded-full">
                        reversed
                      </Badge>
                    )}
                    {v.appeals[0] && (
                      <Badge
                        variant={APPEAL_STATUS_BADGE[v.appeals[0].status] ?? "outline"}
                        className="rounded-full"
                      >
                        appeal {pretty(v.appeals[0].status)}
                      </Badge>
                    )}
                    {v.moderationCaseId && (
                      <Link
                        href={`/admin/moderation-cases/${v.moderationCaseId}`}
                        className="text-muted-foreground text-xs font-medium underline-offset-2 hover:underline"
                      >
                        case
                      </Link>
                    )}
                    <span className="text-muted-foreground ml-auto text-xs">
                      {formatAgo(v.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {moderationCases.length > 0 && (
            <>
              <h3 className="text-muted-foreground mt-4 mb-1.5 text-xs font-medium tracking-wide uppercase">
                Moderation cases
              </h3>
              <ul className="divide-y">
                {moderationCases.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
                    <Badge
                      variant={SEVERITY_BADGE[c.severity] ?? "outline"}
                      className="rounded-full"
                    >
                      {pretty(c.severity)}
                    </Badge>
                    <Badge
                      variant={CASE_STATUS_BADGE[c.status] ?? "outline"}
                      className="rounded-full"
                    >
                      {pretty(c.status)}
                    </Badge>
                    <Link
                      href={`/admin/moderation-cases/${c.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {pretty(c.caseType)}
                    </Link>
                    <span className="text-muted-foreground ml-auto text-xs">
                      {formatAgo(c.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {violations.length === 0 && moderationCases.length === 0 && (
            <p className="text-muted-foreground mt-3 text-sm">
              No violations or moderation cases on file.
            </p>
          )}
        </Section>

        <Section title="IP history">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Field label="Last login IP (hash)">
              <span className="font-mono text-xs">{shortHash(user.lastLoginIpHash)}</span>
            </Field>
            <Field label="Previous IP (hash)">
              <span className="font-mono text-xs">{shortHash(user.previousIpHash)}</span>
            </Field>
            <Field label="Country">{user.lastIpCountry ?? "-"}</Field>
            <Field label="ASN">{user.lastIpAsn ?? "-"}</Field>
          </dl>
          <p className="text-muted-foreground mt-3 text-xs">
            Raw IPs are never stored - only salted hashes, for correlation.
          </p>
        </Section>

        <Section title={`Devices (${user.deviceCount})`}>
          {user.devices.length === 0 ? (
            <p className="text-muted-foreground text-sm">No devices recorded.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Platform</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Trusted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {user.devices.map((device) => (
                  <TableRow key={device.id}>
                    <TableCell className="text-sm">{device.platform ?? "-"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {stampDate(device.lastSeenAt)}
                    </TableCell>
                    <TableCell className="text-sm">{device.trusted ? "Yes" : "No"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>

        <Section title="Verification history">
          {user.verifications.length === 0 ? (
            <p className="text-muted-foreground text-sm">No verification records.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {user.verifications.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="text-sm">{v.type}</TableCell>
                    <TableCell>
                      <Badge
                        variant={VERIFICATION_STATUS_BADGE[v.status] ?? "outline"}
                        className="rounded-full"
                      >
                        {pretty(v.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{v.provider ?? "-"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {stampDate(v.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>

        <Section title="Auth events (newest 20)">
          {events.length === 0 ? (
            <p className="text-muted-foreground text-sm">No auth events recorded.</p>
          ) : (
            <ul className="space-y-2">
              {events.map((event) => (
                <li key={event.id} className="text-sm">
                  <span className="font-medium">{event.type}</span>
                  <span className="text-muted-foreground ml-1.5 text-xs">
                    {formatAgo(event.createdAt)}
                    {event.phoneE164 ? ` · ${event.phoneE164}` : ""}
                    {event.ipHash ? ` · ip ${shortHash(event.ipHash)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
