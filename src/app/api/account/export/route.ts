import { requireSession, unauthorized } from "@/lib/api";
import { db } from "@/lib/db";

/**
 * GDPR data export (Art. 20 - data portability).
 * Returns the user's personal data as a downloadable JSON document.
 */
export async function GET() {
  const { user, response } = await requireSession();
  if (response) return response ?? unauthorized();

  const [account, profile, photos, likes, matches, messages, payments] = await Promise.all([
    db.user.findUnique({
      where: { id: user.id },
      select: {
        email: true,
        name: true,
        createdAt: true,
        // Canonical verification verdicts (see lib/services/verification.ts)
        emailVerified: true,
        phoneVerifiedAt: true,
        photoVerifiedAt: true,
        marketingOptIn: true,
      },
    }),
    db.profile.findUnique({
      where: { userId: user.id },
      include: { interests: { include: { interest: { select: { label: true } } } } },
    }),
    db.photo.findMany({ where: { userId: user.id }, select: { url: true, createdAt: true } }),
    db.like.findMany({ where: { fromId: user.id }, select: { action: true, createdAt: true } }),
    db.match.findMany({
      where: { OR: [{ userAId: user.id }, { userBId: user.id }] },
      select: { createdAt: true, status: true },
    }),
    db.message.findMany({
      where: { senderId: user.id },
      select: { body: true, createdAt: true },
    }),
    db.payment.findMany({
      where: { userId: user.id },
      select: { amountCents: true, currency: true, status: true, createdAt: true },
    }),
  ]);

  const exportDoc = {
    exportedAt: new Date().toISOString(),
    account,
    profile,
    photos,
    activity: { likes, matches },
    messages,
    payments,
  };

  return new Response(JSON.stringify(exportDoc, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="tirvea-data-export.json"`,
    },
  });
}
