"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BIO_MAX_LENGTH } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client/browser";
import { cn } from "@/lib/utils";

/**
 * Bio editor form. Plain text only (rendered with whitespace-pre-wrap on
 * the display surfaces - never HTML); empty saves as null server-side, so
 * clearing the field and saving removes the bio. Loading state lives on
 * the Save button only.
 */
export function BioForm({ initialBio }: { initialBio: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initialBio ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const remaining = BIO_MAX_LENGTH - value.length;

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    const result = await api.profile.updateBio(value.trim() === "" ? null : value.trim());
    setSaving(false);
    if (!result.ok) {
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
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="glass rounded-3xl p-5">
        <label
          htmlFor="bio"
          className="text-muted-foreground text-[11px] font-semibold tracking-[0.2em] uppercase"
        >
          Your story
        </label>
        <Textarea
          ref={textareaRef}
          id="bio"
          name="bio"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          maxLength={BIO_MAX_LENGTH}
          rows={6}
          autoFocus
          placeholder="What makes an evening with you memorable?"
          aria-describedby={error ? "bio-error" : "bio-counter"}
          aria-invalid={error ? true : undefined}
          className="mt-2.5 min-h-36 rounded-2xl"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <p
            id="bio-counter"
            aria-live="polite"
            className={cn(
              "text-[11px] tabular-nums",
              remaining < 40 ? "text-warning" : "text-muted-foreground",
            )}
          >
            {value.length}/{BIO_MAX_LENGTH}
          </p>
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setValue("");
                setError(null);
                textareaRef.current?.focus();
              }}
              className="text-muted-foreground hover:text-foreground text-[11px] font-medium underline-offset-2 transition-colors hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {error && (
        <p id="bio-error" role="alert" className="text-warning px-1 text-sm">
          {error}
        </p>
      )}

      <div className="flex justify-end pt-1">
        <Button type="submit" disabled={saving} className="h-12 rounded-full px-8">
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}
