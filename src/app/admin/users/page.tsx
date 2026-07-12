import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserRowActions } from "./row-actions";
import { formatRelativeTime } from "@/lib/utils";
import { requireAdminPage } from "@/lib/auth/require-user";
import { ACCOUNT_STATUS_BADGE } from "../safety-badges";

export const metadata: Metadata = { title: "Users" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  if (!(await requireAdminPage())) return null; // layout renders AccessDenied; keep segment payload empty
  const { q } = await searchParams;

  const users = await db.user.findMany({
    where: q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
            { profile: { is: { displayName: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : undefined,
    include: {
      profile: { select: { displayName: true, city: true } },
      subscription: { select: { tier: true } },
      _count: { select: { reportsReceived: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <>
      <PageHeader title="Users" description={`${users.length} shown · newest first`} />

      <form className="mb-4" action="/admin/users" method="get">
        <Input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by email or name…"
          className="h-11 max-w-sm rounded-2xl"
          aria-label="Search users"
        />
      </form>

      <div className="overflow-x-auto rounded-3xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Reports</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <Link href={`/admin/users/${user.id}`} className="font-medium hover:underline">
                    {user.profile?.displayName ?? user.name ?? "-"}
                  </Link>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </TableCell>
                <TableCell>
                  <Badge variant={ACCOUNT_STATUS_BADGE[user.status] ?? "outline"} className="rounded-full">
                    {user.status.toLowerCase().replace(/_/g, " ")}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{user.subscription?.tier ?? "FREE"}</TableCell>
                <TableCell className="text-sm tabular-nums">
                  {user._count.reportsReceived}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatRelativeTime(user.createdAt)} ago
                </TableCell>
                <TableCell className="text-right">
                  <UserRowActions userId={user.id} status={user.status} />
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No users match that search.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
