import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { formatAgo } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { humanizeAdminAction, shortId } from "../safety-badges";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

/** Forensic record: absolute timestamp, relative form in the tooltip. */
function stamp(date: Date): string {
  return date.toLocaleString("en-IE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminAuditPage() {
  if (!(await requireAdminPage())) return null; // layout renders AccessDenied; keep segment payload empty
  const entries = await db.adminLog.findMany({
    include: { actor: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of privileged and safety-relevant actions. Newest first."
      />
      <div className="bg-card overflow-x-auto rounded-3xl border">
        <Table>
          <TableHeader>
            <TableRow>
              {/* Reading order mirrors the sentence: actor did action to target, when. */}
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead className="text-right">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="max-w-56">
                  <span className="block truncate text-sm" title={entry.actor.email}>
                    {entry.actor.email}
                  </span>
                </TableCell>
                <TableCell>
                  {/* Humanized for scanning; the raw code stays one hover away. */}
                  <span className="text-sm font-medium" title={entry.action}>
                    {humanizeAdminAction(entry.action)}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {entry.targetType ? (
                    <span title={entry.targetId ?? undefined}>
                      {entry.targetType}{" "}
                      {entry.targetId ? (
                        <code className="bg-muted rounded-md px-1.5 py-0.5 font-mono text-xs">
                          {shortId(entry.targetId)}
                        </code>
                      ) : (
                        "-"
                      )}
                    </span>
                  ) : (
                    "-"
                  )}
                </TableCell>
                <TableCell
                  className="text-muted-foreground text-right text-sm whitespace-nowrap tabular-nums"
                  title={formatAgo(entry.createdAt)}
                >
                  {stamp(entry.createdAt)}
                </TableCell>
              </TableRow>
            ))}
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground py-10 text-center">
                  No audit entries yet. Privileged actions are recorded here as they happen.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
