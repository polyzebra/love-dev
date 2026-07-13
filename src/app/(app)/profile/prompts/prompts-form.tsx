"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PROFILE_PROMPTS } from "@/config/prompts";
import { PROMPT_ANSWER_MAX_LENGTH } from "@/lib/validators/profile";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RevealGroup, RevealItem } from "@/components/fx/reveal";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client/browser";

const MAX_ANSWERED = 4;

export function PromptsForm({ initialAnswers }: { initialAnswers: Record<string, string> }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const answeredCount = PROFILE_PROMPTS.filter(
    (p) => (answers[p.key] ?? "").trim().length > 0,
  ).length;
  const overLimit = answeredCount > MAX_ANSWERED;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const answered = PROFILE_PROMPTS.map((p) => ({
      key: p.key as string,
      answer: (answers[p.key] ?? "").trim(),
    })).filter((p) => p.answer.length > 0);

    const result = await api.profile.savePrompts(answered);
    if (!result.ok) {
      setPending(false);
      if (result.status === 404) {
        // No profile yet - finish onboarding first (same as the old action).
        router.push("/onboarding");
        return;
      }
      const fieldMessage = result.error.fields
        ? Object.values(result.error.fields).flat()[0]
        : undefined;
      setError(fieldMessage ?? result.error.message);
      return;
    }
    router.push("/profile");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <p
          className={cn(
            "text-xs font-semibold tracking-[0.2em] uppercase",
            overLimit ? "text-warning" : "text-muted-foreground",
          )}
        >
          {answeredCount}/{MAX_ANSWERED} answered
        </p>
        {(error || overLimit) && (
          <p className="text-warning text-xs" role="alert">
            {overLimit ? `Answer at most ${MAX_ANSWERED} prompts` : error}
          </p>
        )}
      </div>

      <RevealGroup className="space-y-4">
        {PROFILE_PROMPTS.map((prompt) => {
          const value = answers[prompt.key] ?? "";
          return (
            <RevealItem key={prompt.key}>
              <div className="glass rounded-3xl p-5">
                <label
                  htmlFor={`prompt-${prompt.key}`}
                  className="text-muted-foreground text-[11px] font-semibold tracking-[0.2em] uppercase"
                >
                  {prompt.label}
                </label>
                <Textarea
                  id={`prompt-${prompt.key}`}
                  name={`prompt:${prompt.key}`}
                  value={value}
                  onChange={(e) =>
                    setAnswers((prev) => ({ ...prev, [prompt.key]: e.target.value }))
                  }
                  maxLength={PROMPT_ANSWER_MAX_LENGTH}
                  rows={2}
                  placeholder="Write something only you could say"
                  // Neutral border, hover and calm focus glow all come
                  // from the Textarea primitive.
                  className="mt-2.5 min-h-16 resize-none rounded-2xl"
                />
                {value.length > 0 && (
                  <p className="text-muted-foreground mt-1.5 text-right text-[11px] tabular-nums">
                    {value.length}/{PROMPT_ANSWER_MAX_LENGTH}
                  </p>
                )}
              </div>
            </RevealItem>
          );
        })}
      </RevealGroup>

      <div className="flex justify-end pt-1">
        <Button type="submit" disabled={pending || overLimit} className="h-12 rounded-full px-8">
          {pending ? "Saving..." : "Save prompts"}
        </Button>
      </div>
    </form>
  );
}
