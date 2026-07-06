import type { Metadata } from "next";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { FlagToggle } from "./flag-toggle";

export const metadata: Metadata = { title: "Feature flags" };
export const dynamic = "force-dynamic";

/** Flags known to the codebase; stored state overrides these defaults. */
const KNOWN_FLAGS = [
  { key: "boosts", description: "Profile Boost purchases and queue priority" },
  { key: "voice-messages", description: "Voice notes in chat" },
  { key: "video-verification", description: "Video selfie verification flow" },
  { key: "advanced-filters", description: "Premium filters (education, height, lifestyle)" },
  { key: "who-likes-you", description: "Likes-you grid for Plus and above" },
  { key: "compatibility-v2", description: "ML compatibility scoring (replaces Jaccard)" },
] as const;

export default async function AdminFlagsPage() {
  const stored = await db.featureFlag.findMany();
  const byKey = new Map(stored.map((f) => [f.key, f]));

  const flags = [
    ...KNOWN_FLAGS.map((f) => ({
      key: f.key,
      description: f.description,
      enabled: byKey.get(f.key)?.enabled ?? false,
    })),
    ...stored
      .filter((f) => !KNOWN_FLAGS.some((k) => k.key === f.key))
      .map((f) => ({ key: f.key, description: f.description ?? "", enabled: f.enabled })),
  ];

  return (
    <>
      <PageHeader
        title="Feature flags"
        description="Toggle features without deploying. Changes apply within seconds."
      />
      <Card className="rounded-3xl">
        <CardContent className="divide-y">
          {flags.map((flag) => (
            <div key={flag.key} className="flex items-center justify-between gap-4 py-4 first:pt-2 last:pb-2">
              <div>
                <p className="font-mono text-sm font-medium">{flag.key}</p>
                <p className="text-sm text-muted-foreground">{flag.description}</p>
              </div>
              <FlagToggle flagKey={flag.key} enabled={flag.enabled} />
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
