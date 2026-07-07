"use client";

import { useActionState, useState } from "react";
import { PROFILE_PROMPTS } from "@/config/prompts";
import { PROMPT_ANSWER_MAX_LENGTH } from "@/lib/validators/profile";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RevealGroup, RevealItem } from "@/components/fx/reveal";
import { cn } from "@/lib/utils";
import { saveProfilePrompts, type SavePromptsState } from "./actions";

const MAX_ANSWERED = 4;

export function PromptsForm({ initialAnswers }: { initialAnswers: Record<string, string> }) {
  const [state, formAction, pending] = useActionState<SavePromptsState, FormData>(
    saveProfilePrompts,
    { error: null },
  );
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);

  const answeredCount = PROFILE_PROMPTS.filter(
    (p) => (answers[p.key] ?? "").trim().length > 0,
  ).length;
  const overLimit = answeredCount > MAX_ANSWERED;

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <p
          className={cn(
            "text-xs font-semibold uppercase tracking-[0.2em]",
            overLimit ? "text-warning" : "text-muted-foreground",
          )}
        >
          {answeredCount}/{MAX_ANSWERED} answered
        </p>
        {(state.error || overLimit) && (
          <p className="text-xs text-warning" role="alert">
            {overLimit ? `Answer at most ${MAX_ANSWERED} prompts` : state.error}
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
                  className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground"
                >
                  {prompt.label}
                </label>
                <Textarea
                  id={`prompt-${prompt.key}`}
                  name={`prompt:${prompt.key}`}
                  value={value}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [prompt.key]: e.target.value }))}
                  maxLength={PROMPT_ANSWER_MAX_LENGTH}
                  rows={2}
                  placeholder="Write something only you could say"
                  className="mt-2.5 min-h-16 resize-none rounded-2xl border-white/10 bg-white/5"
                />
                {value.length > 0 && (
                  <p className="mt-1.5 text-right text-[11px] tabular-nums text-muted-foreground">
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
