import { db } from "@/lib/db";
import { teardownAccount } from "@/lib/auth/identity";

/**
 * Supabase Auth webhook - keeps the app User table in lockstep with
 * auth.users (configure a Database Webhook on auth.users or an Auth
 * Hook pointing here with the shared secret).
 * Deletion in Supabase == full account deletion here. No polling.
 */
export async function POST(req: Request) {
  const secret = process.env.SUPABASE_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = (await req.json().catch(() => null)) as {
    type?: string;
    record?: { id?: string; email?: string; email_confirmed_at?: string | null };
    old_record?: { id?: string };
  } | null;
  if (!payload?.type) return Response.json({ error: "bad payload" }, { status: 400 });

  const type = payload.type.toUpperCase(); // INSERT|UPDATE|DELETE (db webhook) or USER_* (auth hook)

  if (type === "DELETE" || type === "USER_DELETED") {
    const id = payload.old_record?.id ?? payload.record?.id;
    if (id) await teardownAccount(id, "auth user deleted (webhook)");
    return Response.json({ ok: true });
  }

  if ((type === "UPDATE" || type === "USER_UPDATED") && payload.record?.id) {
    const r = payload.record;
    await db.user
      .update({
        where: { id: r.id! },
        data: {
          ...(r.email ? { email: r.email.toLowerCase() } : {}),
          emailVerified: r.email_confirmed_at ? new Date(r.email_confirmed_at) : null,
        },
      })
      .catch(() => {}); // row appears at first callback if not yet present
    return Response.json({ ok: true });
  }

  // USER_CREATED: no-op - the app row is created by /auth/callback on
  // first sign-in so a half-registered auth user never gets app state.
  return Response.json({ ok: true });
}
