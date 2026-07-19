import type { Metadata } from "next";
import Link from "next/link";
import { Download, Inbox } from "lucide-react";
import { requireAdminPage } from "@/lib/auth/require-user";
import { listSupportRequests } from "@/lib/services/support";
import { SUPPORT_CATEGORY_LABELS } from "@/lib/support/schema";
import type { SupportStatus } from "@/generated/prisma/enums";
import { cn, formatAgo } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "Support" };
export const dynamic = "force-dynamic";

const STATUS_FILTERS = [
  { key: "open", label: "Open" },
  { key: "OPEN", label: "New" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "WAITING_USER", label: "Waiting" },
  { key: "RESOLVED", label: "Resolved" },
  { key: "CLOSED", label: "Closed" },
  { key: "all", label: "All" },
] as const;

const STATUS_TONE: Record<SupportStatus, string> = {
  OPEN: "bg-primary/15 text-primary-soft",
  IN_PROGRESS: "bg-amber-500/15 text-amber-600",
  WAITING_USER: "bg-blue-500/15 text-blue-600",
  RESOLVED: "bg-emerald-500/15 text-emerald-600",
  CLOSED: "bg-muted text-muted-foreground",
};

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; category?: string; q?: string; page?: string; spam?: string }>;
}) {
  if (!(await requireAdminPage())) return null;
  const sp = await searchParams;
  const status = (sp.status ?? "open") as "open" | "all" | SupportStatus;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const includeSpam = sp.spam === "1";

  const { rows, total, pages } = await listSupportRequests({
    status,
    category: sp.category as never,
    search: sp.q,
    includeSpam,
    page,
    pageSize: 25,
  });

  const qs = (patch: Record<string, string | undefined>) => {
    const merged = { status: String(status), q: sp.q, category: sp.category, spam: sp.spam, ...patch };
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v);
    return `?${u.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Support"
        description="Inbound contact and support requests. Persisted first, notified second."
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={qs({ status: f.key, page: undefined })}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              String(status) === f.key
                ? "border-foreground/20 bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <Link
            href={qs({ spam: includeSpam ? undefined : "1", page: undefined })}
            className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
          >
            {includeSpam ? "Hide spam" : "Show spam"}
          </Link>
          <a
            href={`/api/admin/support/export${includeSpam ? "?includeSpam=1" : ""}`}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm underline underline-offset-4"
          >
            <Download className="size-3.5" aria-hidden="true" /> Export CSV
          </a>
        </div>
      </div>

      <form method="get" className="mb-5">
        <input type="hidden" name="status" value={String(status)} />
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search email, name, reference…"
          className="border-input bg-background focus-visible:ring-ring/60 h-10 w-full max-w-sm rounded-xl border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
          aria-label="Search support requests"
        />
      </form>

      {rows.length === 0 ? (
        <EmptyState icon={Inbox} title="No requests" description="Nothing matches these filters." />
      ) : (
        <div className="border-border overflow-hidden rounded-2xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-left text-xs">
              <tr>
                <th className="px-4 py-2.5 font-medium">Received</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">From</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Priority</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-border/60 hover:bg-muted/30 border-t">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Link href={`/admin/support/${r.id}`} className="hover:underline">
                      {formatAgo(r.createdAt)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{SUPPORT_CATEGORY_LABELS[r.category]}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/support/${r.id}`} className="hover:underline">
                      {r.name}
                    </Link>
                    <div className="text-muted-foreground text-xs">{r.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs", STATUS_TONE[r.status])}>
                      {r.status.replace(/_/g, " ").toLowerCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {r.priority !== "NORMAL" ? (
                      <Badge variant="secondary" className="rounded-full text-[10px]">
                        {r.priority.toLowerCase()}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">normal</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
        <div className="text-muted-foreground mt-4 flex items-center justify-between text-sm">
          <span>
            {total} request{total === 1 ? "" : "s"} · page {page} of {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={qs({ page: String(page - 1) })} className="hover:text-foreground underline">
                Previous
              </Link>
            ) : null}
            {page < pages ? (
              <Link href={qs({ page: String(page + 1) })} className="hover:text-foreground underline">
                Next
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
