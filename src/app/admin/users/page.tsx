import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
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
import { formatAgo } from "@/lib/utils";
import { requireAdminPage } from "@/lib/auth/require-user";
import { ACCOUNT_STATUS_BADGE, pretty } from "../safety-badges";

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
      <PageHeader
        title="Users"
        description={
          q ? `${users.length} matching "${q}" · newest first` : `${users.length} shown · newest first`
        }
      />

      {/* Same search shell as moderation cases: icon inside, Clear beside. */}
      <form className="mb-4 flex max-w-md gap-2" action="/admin/users" method="get" role="search">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by email or name"
            className="h-11 rounded-full pl-10"
            aria-label="Search users by email or name"
          />
        </div>
        {q && (
          <Link
            href="/admin/users"
            className="flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="overflow-x-auto rounded-3xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Reports</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="max-w-56">
                  <Link
                    href={`/admin/users/${user.id}`}
                    title={user.profile?.displayName ?? user.name ?? user.email}
                    className="block truncate font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/20"
                  >
                    {user.profile?.displayName ?? user.name ?? "-"}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground" title={user.email}>
                    {user.email}
                  </p>
                </TableCell>
                <TableCell>
                  <Badge variant={ACCOUNT_STATUS_BADGE[user.status] ?? "outline"} className="rounded-full">
                    {pretty(user.status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{user.subscription?.tier ?? "FREE"}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {user._count.reportsReceived}
                </TableCell>
                <TableCell
                  className="text-sm text-muted-foreground"
                  title={user.createdAt.toLocaleString("en-IE")}
                >
                  {formatAgo(user.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  <UserRowActions userId={user.id} status={user.status} />
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  {q ? (
                    <>
                      No results for &ldquo;{q}&rdquo;.{" "}
                      <Link
                        href="/admin/users"
                        className="font-medium text-foreground underline underline-offset-2"
                      >
                        Clear search
                      </Link>
                    </>
                  ) : (
                    "No users yet."
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
