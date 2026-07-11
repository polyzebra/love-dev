import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

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
        description="Append-only record of privileged and safety-relevant actions."
      />
      <div className="overflow-x-auto rounded-3xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {entry.createdAt.toLocaleString("en-IE")}
                </TableCell>
                <TableCell className="text-sm">{entry.actor.email}</TableCell>
                <TableCell>
                  <code className="rounded-md bg-muted px-2 py-0.5 text-xs">{entry.action}</code>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {entry.targetType ? `${entry.targetType}:${entry.targetId ?? "-"}` : "-"}
                </TableCell>
              </TableRow>
            ))}
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No audit entries yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
