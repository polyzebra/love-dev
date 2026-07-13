import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { Reveal } from "@/components/fx/reveal";
import { PromptsForm } from "./prompts-form";

export const metadata: Metadata = { title: "Your prompts" };

export default async function ProfilePromptsPage() {
  const user = await requireUser();
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
    select: {
      prompts: { orderBy: { sortOrder: "asc" }, select: { promptKey: true, answer: true } },
    },
  });
  if (!profile) redirect("/onboarding");

  const initialAnswers = Object.fromEntries(profile.prompts.map((p) => [p.promptKey, p.answer]));

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
          <h1 className="font-display text-3xl font-medium tracking-tight md:text-4xl">
            Your prompts
          </h1>
          <p className="text-muted-foreground max-w-md text-sm">
            Answer up to 4. Your answers become conversation starters - people reply to your words,
            not your stats.
          </p>
        </div>
      </Reveal>
      <PromptsForm initialAnswers={initialAnswers} />
    </div>
  );
}
