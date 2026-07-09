import { db } from "@/lib/db";
import { isDisposableEmail } from "@/lib/auth/disposable-domains";

/**
 * Scam/spam scoring - additive 0-100 built ONLY from real app data the
 * user actually produced: likes, messages, reports and blocks. No
 * behavioural guesswork, no external services, nothing fabricated.
 * Recomputed lazily (admin user page / batch), never on the hot path.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Signal weights - additive, capped at 100. */
export const SCAM_WEIGHTS = {
  /** >=80 likes sent in the last 24h. */
  likes_24h_80plus: 20,
  /** >=150 likes sent in the last 24h (replaces the 80+ tier). */
  likes_24h_150plus: 40,
  /** >=100 messages sent in the last 24h. */
  messages_24h_100plus: 20,
  /** Same exact message body sent to >=5 distinct conversations in 7d. */
  copy_paste_messages: 25,
  /** >=5 messages containing an http(s) link in the last 7d. */
  link_messages: 15,
  /** Per OPEN or ACTION_TAKEN report received (capped at 30 total). */
  report_received: 10,
  report_received_cap: 30,
  /** >=3 blocks received in the last 30d. */
  blocks_30d_3plus: 15,
  /** Registered with a disposable email domain. */
  disposable_email: 10,
} as const;

export type ScamEvaluation = {
  userId: string;
  score: number;
  /** Signal names that fired (auditable, joined nowhere - score only). */
  reasons: string[];
};

/**
 * Compute and persist User.scamScore for one user. Returns the score
 * with the signal names that fired so callers (admin UI) can explain it.
 */
export async function computeScamScore(userId: string): Promise<ScamEvaluation> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) return { userId, score: 0, reasons: [] };

  const now = Date.now();
  const day = new Date(now - DAY_MS);
  const week = new Date(now - 7 * DAY_MS);
  const month = new Date(now - 30 * DAY_MS);

  const [likes24h, messages24h, linkMessages7d, openReports, blocks30d] = await Promise.all([
    db.like.count({ where: { fromId: userId, createdAt: { gte: day } } }),
    db.message.count({ where: { senderId: userId, createdAt: { gte: day } } }),
    db.message.count({
      where: {
        senderId: userId,
        createdAt: { gte: week },
        body: { contains: "http" },
        deletedAt: null,
      },
    }),
    db.report.count({
      where: { reportedId: userId, status: { in: ["OPEN", "ACTION_TAKEN"] } },
    }),
    db.block.count({ where: { blockedId: userId, createdAt: { gte: month } } }),
  ]);

  // Copy-paste blast: the SAME body (string equality) sent to >=5
  // distinct conversations within 7 days.
  let copyPasteBodies = 0;
  try {
    const rows = await db.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM (
        SELECT body FROM "Message"
        WHERE "senderId" = ${userId}
          AND "createdAt" >= ${week}
          AND body IS NOT NULL
          AND "deletedAt" IS NULL
        GROUP BY body
        HAVING COUNT(DISTINCT "conversationId") >= 5
      ) duplicated`;
    copyPasteBodies = rows[0]?.n ?? 0;
  } catch (error) {
    console.warn(`[scam] copy-paste query failed: ${String(error).slice(0, 80)}`);
  }

  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };

  if (likes24h >= 150) add(SCAM_WEIGHTS.likes_24h_150plus, "likes_24h_150plus");
  else if (likes24h >= 80) add(SCAM_WEIGHTS.likes_24h_80plus, "likes_24h_80plus");

  if (messages24h >= 100) add(SCAM_WEIGHTS.messages_24h_100plus, "messages_24h_100plus");
  if (copyPasteBodies >= 1) add(SCAM_WEIGHTS.copy_paste_messages, "copy_paste_messages");
  if (linkMessages7d >= 5) add(SCAM_WEIGHTS.link_messages, "link_messages");

  if (openReports > 0) {
    add(
      Math.min(openReports * SCAM_WEIGHTS.report_received, SCAM_WEIGHTS.report_received_cap),
      `reports_received_x${openReports}`,
    );
  }

  if (blocks30d >= 3) add(SCAM_WEIGHTS.blocks_30d_3plus, "blocks_30d_3plus");
  if (isDisposableEmail(user.email)) add(SCAM_WEIGHTS.disposable_email, "disposable_email");

  score = Math.min(100, score);
  await db.user.update({ where: { id: userId }, data: { scamScore: score } });

  return { userId, score, reasons };
}

/**
 * Batch recompute for admin/cron use - most recently active accounts
 * first (they are the ones whose behaviour changed). NOT wired to any
 * scheduler: the admin surface calls this lazily.
 */
export async function recomputeScamScores(limit: number): Promise<ScamEvaluation[]> {
  const users = await db.user.findMany({
    where: { status: { in: ["ACTIVE", "SHADOW_BANNED"] } },
    orderBy: { lastActiveAt: "desc" },
    take: Math.max(1, Math.min(limit, 500)),
    select: { id: true },
  });
  const results: ScamEvaluation[] = [];
  for (const { id } of users) {
    results.push(await computeScamScore(id));
  }
  return results;
}
