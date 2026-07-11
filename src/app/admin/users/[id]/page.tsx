import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck, CircleDashed } from "lucide-react";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { countryByIso } from "@/lib/auth/countries";
import { maskPhone } from "@/lib/phone-mask";
import { computeScamScore } from "@/lib/services/scam";
import { formatRelativeTime } from "@/lib/utils";
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
import { TrustActions } from "./trust-actions";

export const metadata: Metadata = { title: "User detail" };
export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ACTIVE: "secondary",
  SUSPENDED: "destructive",
  SHADOW_BANNED: "outline",
  DEACTIVATED: "outline",
  DELETED: "outline",
};

/** Salted hashes are long - show enough to compare, never pretend it's an IP. */
function shortHash(hash: string | null): string {
  return hash ? `${hash.slice(0, 12)}…` : "-";
}

function stampDate(date: Date | null): string {
  return date ? `${formatRelativeTime(date)} ago` : "-";
}

function VerifiedStamp({ verifiedAt, label }: { verifiedAt: Date | null; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-sm">
      {verifiedAt ? (
        <BadgeCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
      ) : (
        <CircleDashed className="size-4 shrink-0 text-muted-foreground/40" aria-hidden="true" />
      )}
      <span className={verifiedAt ? "" : "text-muted-foreground"}>
        {label}
        {verifiedAt ? ` · ${formatRelativeTime(verifiedAt)} ago` : ""}
      </span>
    </span>
  );
}

const SYNC_BADGE: Record<string, "secondary" | "outline" | "destructive"> = {
  SYNCED: "secondary",
  PENDING: "outline",
  FAILED: "destructive",
};

/** auth.users.phone mirror disposition - "-" when no verified phone. */
function PhoneSyncBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">sync -</span>;
  return (
    <Badge variant={SYNC_BADGE[status] ?? "outline"} className="rounded-full">
      sync {status.toLowerCase()}
    </Badge>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border bg-card p-5">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // The admin layout admits MODERATOR too - the raw E.164 below is
  // revealed to ADMIN only, everyone else gets the masked form.
  const viewer = await currentUser();
  const viewerIsAdmin = viewer?.role === "ADMIN";

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

  // Scam score is recomputed lazily on page load - always fresh, always
  // derived from real persisted signals. Failure renders "-", never a guess.
  let scam: Awaited<ReturnType<typeof computeScamScore>> | null = null;
  try {
    scam = await computeScamScore(user.id);
  } catch {
    scam = null;
  }

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

  return (
    <>
      <Link
        href="/admin/users"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> All users
      </Link>

      <PageHeader
        title={user.profile?.displayName ?? user.name ?? user.email}
        description={`${user.email} · id ${user.id}`}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[user.status] ?? "outline"} className="rounded-full">
          {user.status.toLowerCase().replace(/_/g, " ")}
        </Badge>
        {banned && (
          <Badge variant="destructive" className="rounded-full">
            banned {user.bannedAt ? `${formatRelativeTime(user.bannedAt)} ago` : ""}
          </Badge>
        )}
        {emailBlock && (
          <Badge variant="outline" className="rounded-full">
            email on blocklist
          </Badge>
        )}
        <span className="text-sm text-muted-foreground">
          Plan {user.subscription?.tier ?? "FREE"}
        </span>
      </div>

      <TrustActions
        userId={user.id}
        banned={banned}
        hasPhone={Boolean(user.phoneE164 ?? user.phone)}
        phoneVerified={Boolean(user.phoneVerifiedAt)}
        phoneSyncStatus={user.phoneSyncStatus}
        emailBlocked={Boolean(emailBlock)}
        onboardingDone={user.onboardingDone}
      />

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Section title="Identity">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Field label="Email">
              <span className="break-all">{user.email}</span>
              <VerifiedStamp verifiedAt={user.emailVerified} label={user.emailVerified ? "Verified" : "Unverified"} />
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
                      <span className="block font-mono text-xs text-muted-foreground">
                        {number}
                      </span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {country?.name ?? "Unknown country"}
                      {user.phoneCountryIso ? ` (${user.phoneCountryIso})` : ""}
                      {user.phoneDialCode ? ` · ${user.phoneDialCode}` : ""}
                    </span>
                    <VerifiedStamp
                      verifiedAt={user.phoneVerifiedAt}
                      label={user.phoneVerifiedAt ? "Verified" : "Unverified"}
                    />
                    <span className="mt-1 block">
                      <PhoneSyncBadge status={user.phoneSyncStatus} />
                      {user.phoneSyncStatus === "FAILED" && user.phoneSyncErrorCode && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {user.phoneSyncErrorCode}
                        </span>
                      )}
                    </span>
                  </>
                );
              })()}
            </Field>
            <Field label="Photo verification">
              <VerifiedStamp verifiedAt={user.photoVerifiedAt} label={user.photoVerifiedAt ? "Verified" : "Not verified"} />
              <span className="text-xs text-muted-foreground">
                Provider: {user.photoVerificationProvider ?? "-"}
              </span>
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
                <span className="block text-xs text-muted-foreground">
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
              {banned ? `Banned ${user.bannedAt ? `${formatRelativeTime(user.bannedAt)} ago` : ""}` : "Not banned"}
            </Field>
            <Field label="Ban reason">{user.banReason ?? "-"}</Field>
          </dl>
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
          <p className="mt-3 text-xs text-muted-foreground">
            Raw IPs are never stored - only salted hashes, for correlation.
          </p>
        </Section>

        <Section title={`Devices (${user.deviceCount})`}>
          {user.devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No devices recorded.</p>
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
                    <TableCell className="text-sm text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">No verification records.</p>
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
                        variant={v.status === "APPROVED" ? "secondary" : "outline"}
                        className="rounded-full"
                      >
                        {v.status.toLowerCase().replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{v.provider ?? "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">No auth events recorded.</p>
          ) : (
            <ul className="space-y-2">
              {events.map((event) => (
                <li key={event.id} className="text-sm">
                  <span className="font-medium">{event.type}</span>
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {formatRelativeTime(event.createdAt)} ago
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
