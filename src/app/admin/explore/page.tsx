import type { Metadata } from "next";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { ExploreCard3DVisual } from "@/components/explore/explore-card";
import { ExploreRowActions } from "./explore-admin-actions";
import { Badge } from "@/components/ui/badge";
import { requireAdminPage } from "@/lib/auth/require-user";

export const metadata: Metadata = { title: "Explore categories" };
export const dynamic = "force-dynamic";

export default async function AdminExplorePage() {
  if (!(await requireAdminPage())) return null; // layout renders AccessDenied; keep segment payload empty
  const categories = await db.exploreCategory.findMany({
    orderBy: [{ group: "asc" }, { sortOrder: "asc" }],
    include: { _count: { select: { preferences: true } } },
  });

  return (
    <>
      <PageHeader
        title="Explore"
        description="Manage discovery categories, order and visibility."
      />
      <ul className="space-y-2">
        {categories.map((c) => (
          <li key={c.id} className="glass flex items-center gap-4 rounded-3xl p-3 pr-4">
            <div className="-m-6 scale-[0.45]" aria-hidden="true">
              <ExploreCard3DVisual
                iconKey={c.iconKey}
                imageUrl={c.imageUrl}
                from={c.gradientFrom}
                to={c.gradientTo}
                title={c.title}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-medium">
                {c.title}
                <Badge variant="secondary" className="rounded-full text-[10px]">
                  {c.group.toLowerCase()}
                </Badge>
                {!c.isActive && (
                  <Badge variant="outline" className="rounded-full text-[10px]">
                    inactive
                  </Badge>
                )}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                /{c.slug} · {c._count.preferences} saved · order {c.sortOrder}
              </p>
            </div>
            <ExploreRowActions id={c.id} isActive={c.isActive} />
          </li>
        ))}
      </ul>
    </>
  );
}
