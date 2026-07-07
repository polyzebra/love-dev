import { db } from "@/lib/db";

/**
 * Honest behavioural signals computed from real message timestamps.
 * Never fabricated: with fewer than 3 observed replies we say so
 * ("New here" / "Not enough data yet") instead of guessing.
 */

export type ReplySignal =
  | "Usually replies within an hour"
  | "Replies same day"
  | "New here"
  | null; // slower or unknown - we never show a negative signal

type ReplyRow = { id: string; replies: number; mediansec: number | null };

/**
 * Median reply latency per user: each message is paired with the
 * previous message in the same conversation when it came from the
 * other person - the gap is that user's reply time.
 */
export async function getReplySignals(
  userIds: string[],
  createdAtById?: Map<string, Date>,
): Promise<Map<string, ReplySignal>> {
  const out = new Map<string, ReplySignal>();
  if (userIds.length === 0) return out;

  let rows: ReplyRow[] = [];
  try {
    rows = await db.$queryRaw<ReplyRow[]>`
      WITH m AS (
        SELECT "senderId", "createdAt",
          LAG("senderId") OVER (PARTITION BY "conversationId" ORDER BY "createdAt") AS prev_sender,
          LAG("createdAt") OVER (PARTITION BY "conversationId" ORDER BY "createdAt") AS prev_at
        FROM "Message"
      )
      SELECT "senderId" AS id, COUNT(*)::int AS replies,
        EXTRACT(EPOCH FROM percentile_cont(0.5) WITHIN GROUP (
          ORDER BY ("createdAt" - prev_at)))::float8 AS mediansec
      FROM m
      WHERE prev_sender IS NOT NULL AND prev_sender <> "senderId"
        AND "senderId" = ANY(${userIds})
      GROUP BY "senderId"`;
  } catch (error) {
    console.warn(`[signals] reply-time query failed: ${String(error).slice(0, 80)}`);
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  const TWO_WEEKS = 14 * 24 * 3600 * 1000;
  for (const id of userIds) {
    const r = byId.get(id);
    if (!r || r.replies < 3 || r.mediansec == null) {
      const created = createdAtById?.get(id);
      out.set(id, created && Date.now() - created.getTime() < TWO_WEEKS ? "New here" : null);
    } else if (r.mediansec <= 3600) {
      out.set(id, "Usually replies within an hour");
    } else if (r.mediansec <= 24 * 3600) {
      out.set(id, "Replies same day");
    } else {
      out.set(id, null);
    }
  }
  return out;
}
