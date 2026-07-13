import type { AppealTimelineEntry } from "@/lib/services/appeals";
import { formatDate } from "../../copy";

/**
 * Calm vertical timeline of one appeal. Notes on staff/user events are
 * user-visible by contract (the needs-info question, the user's reply);
 * system events render quietly. No colour drama - the state cards above
 * carry the tone, this list is just the record.
 */

const EVENT_LABEL: Record<string, string> = {
  submitted: "You submitted this appeal",
  under_review: "A member of our team started reviewing",
  needs_info_requested: "Our team asked for more information",
  user_responded: "You replied",
  approved: "Appeal approved - the action was reversed",
  rejected: "Reviewed - the original decision stays in place",
  withdrawn: "You withdrew this appeal",
  expired: "This appeal was closed",
};

export function AppealTimeline({ timeline }: { timeline: AppealTimelineEntry[] }) {
  if (timeline.length === 0) return null;
  return (
    <section aria-label="Appeal timeline" className="mt-6">
      <h2 className="text-muted-foreground px-1 text-sm font-semibold tracking-wide uppercase">
        Appeal timeline
      </h2>
      <ol className="mt-3 space-y-0">
        {timeline.map((entry, i) => {
          const quiet = entry.actorRole === "SYSTEM";
          const last = i === timeline.length - 1;
          return (
            <li
              key={`${entry.type}-${entry.at.getTime()}-${i}`}
              className="relative flex gap-3.5 pl-1"
            >
              {/* Rail: dot + connecting line */}
              <span aria-hidden="true" className="flex w-3 flex-col items-center">
                <span
                  className={`mt-1.5 size-2.5 shrink-0 rounded-full ${
                    quiet ? "bg-border" : "bg-foreground/40"
                  }`}
                />
                {!last && <span className="bg-border w-px flex-1" />}
              </span>
              <div className={`min-w-0 flex-1 ${last ? "pb-1" : "pb-5"}`}>
                <p className={`text-sm ${quiet ? "text-muted-foreground" : "font-medium"}`}>
                  {EVENT_LABEL[entry.type] ?? "Update"}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">{formatDate(entry.at)}</p>
                {entry.note && (
                  <p
                    className={`mt-2 rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      quiet ? "text-muted-foreground" : "bg-muted"
                    }`}
                  >
                    {entry.note}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
