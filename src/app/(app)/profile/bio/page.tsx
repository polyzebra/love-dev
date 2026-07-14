import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { Reveal } from "@/components/fx/reveal";
import { BioForm } from "./bio-form";

export const metadata: Metadata = { title: "About me" };

/** Dedicated Bio editor - same anatomy as /profile/prompts. */
export default async function ProfileBioPage() {
  const user = await requireUser();
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
    select: { bio: true },
  });
  if (!profile) redirect("/onboarding");

  return (
    <div className="space-y-6">
      <Reveal y={16}>
        <div className="space-y-3">
          <Link
            href="/profile"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to profile
          </Link>
          <h1 className="font-display text-3xl font-medium tracking-tight md:text-4xl">About me</h1>
          <p className="text-muted-foreground max-w-md text-sm">
            A few honest lines in your own voice. Profiles with a story get far more matches than
            stats alone.
          </p>
        </div>
      </Reveal>
      <Reveal y={16}>
        <BioForm initialBio={profile.bio} />
      </Reveal>
    </div>
  );
}
