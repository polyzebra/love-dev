import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdminPage } from "@/lib/auth/require-user";
import { getSupportRequest } from "@/lib/services/support";
import { SUPPORT_CATEGORY_LABELS } from "@/lib/support/schema";
import { formatAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { SupportActions } from "@/components/admin/support-actions";

export const metadata: Metadata = { title: "Support request" };
export const dynamic = "force-dynamic";

export default async function AdminSupportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await requireAdminPage())) return null;
  const { id } = await params;
  const request = await getSupportRequest(id);
  if (!request) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/admin/support"
        className="text-muted-foreground hover:text-foreground mb-5 inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to support
      </Link>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {SUPPORT_CATEGORY_LABELS[request.category]}
        </h1>
        <Badge variant="secondary" className="rounded-full">
          {request.status.replace(/_/g, " ").toLowerCase()}
        </Badge>
        {request.priority !== "NORMAL" ? (
          <Badge variant="outline" className="rounded-full">
            {request.priority.toLowerCase()}
          </Badge>
        ) : null}
        {request.spam ? (
          <Badge variant="destructive" className="rounded-full">
            spam
          </Badge>
        ) : null}
      </div>

      <dl className="border-border grid grid-cols-1 gap-x-8 gap-y-2 rounded-2xl border p-5 text-sm sm:grid-cols-2">
        <Field label="From" value={`${request.name} <${request.email}>`} />
        <Field label="Received" value={formatAgo(request.createdAt)} />
        {request.accountEmail ? <Field label="Account email" value={request.accountEmail} /> : null}
        {request.reference ? <Field label="Reference" value={request.reference} /> : null}
        <Field label="Assigned" value={request.assignedAdmin ?? "unassigned"} />
        <Field label="Notified" value={request.emailDelivered ? "email sent" : "not sent (retained)"} />
        <Field label="Signed in" value={request.userId ? "yes" : "no"} />
      </dl>

      <section aria-labelledby="msg" className="mt-6">
        <h2 id="msg" className="text-foreground text-sm font-semibold">
          Message
        </h2>
        {/* Rendered as text - React escapes it, so no HTML injection. */}
        <p className="border-border mt-2 rounded-2xl border p-4 text-sm leading-relaxed whitespace-pre-wrap">
          {request.message}
        </p>
      </section>

      <section aria-labelledby="actions" className="mt-6">
        <h2 id="actions" className="text-foreground mb-2 text-sm font-semibold">
          Actions
        </h2>
        <SupportActions
          id={request.id}
          status={request.status}
          priority={request.priority}
          spam={request.spam}
          assigned={!!request.assignedAdmin}
        />
      </section>

      <section aria-labelledby="notes" className="mt-6">
        <h2 id="notes" className="text-foreground text-sm font-semibold">
          Internal notes ({request.notes.length})
        </h2>
        {request.notes.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">No notes yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {request.notes.map((n) => (
              <li key={n.id} className="border-border rounded-2xl border p-4 text-sm">
                <div className="text-muted-foreground mb-1 text-xs">
                  {n.authorId ?? "staff"} · {formatAgo(n.createdAt)}
                </div>
                <p className="leading-relaxed whitespace-pre-wrap">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 sm:block">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground break-all">{value}</dd>
    </div>
  );
}
