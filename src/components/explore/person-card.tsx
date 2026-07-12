"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BadgeCheck, Sparkles } from "lucide-react";
import { OnlineDot } from "@/components/shared/online-dot";
import { PhotoFrame } from "@/components/shared/photo-frame";
import { initialsOf } from "@/lib/utils";

export type PersonCardData = {
  userId: string;
  displayName: string;
  age: number;
  isVerified: boolean;
  isOnline: boolean;
  sharedInterests: number;
  photo: { url: string; galleryUrl: string | null; blurDataUrl: string | null } | null;
};

/** Grid card - opens the immersive viewer as a modal route (?profile=id). */
export function ExplorePersonCard({ person }: { person: PersonCardData }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function open() {
    void fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "explore_profile_clicked", data: { userId: person.userId } }),
    }).catch(() => {});
    const q = new URLSearchParams(params);
    q.set("profile", person.userId);
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
  }

  return (
    <button
      type="button"
      onClick={open}
      aria-label={`View ${person.displayName}'s profile`}
      className="group relative block w-full overflow-hidden rounded-3xl border border-border bg-card/80 text-left shadow-card transition-shadow hover:shadow-float"
    >
      <PhotoFrame
        photo={person.photo}
        alt={`${person.displayName}'s photo`}
        variant="gallery"
        loading="lazy"
        radius="none"
        className="bg-muted"
        imgClassName="transition-[opacity,filter,transform] duration-300 group-hover:scale-[1.03]"
        fallback={
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-foreground/10 to-transparent font-display text-3xl text-foreground/60">
            {initialsOf(person.displayName)}
          </div>
        }
      >
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
            <span className="truncate" title={`${person.displayName}, ${person.age}`}>
              {person.displayName}, {person.age}
            </span>
            {person.isVerified && <BadgeCheck className="size-4 shrink-0 fill-sky-400 text-black/40" aria-label="Photo verified" />}
            <OnlineDot online={person.isOnline} className="ml-auto shrink-0" />
          </p>
          {person.sharedInterests > 0 && (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-white/80">
              <Sparkles className="size-3 text-gold" aria-hidden="true" />
              {person.sharedInterests} shared interest{person.sharedInterests > 1 ? "s" : ""}
            </p>
          )}
        </div>
      </PhotoFrame>
    </button>
  );
}
