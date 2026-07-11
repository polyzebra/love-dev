import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Canonical landing spot for restricted accounts (the auth gate's
 * RESTRICTED_ACCOUNT_ROUTE still points here - see gate.ts, and the gate
 * tests assert the literal path). The page itself moved into the Appeals
 * Centre: /account/status renders the status card, violations and the
 * appeal flow, so this route simply forwards there.
 */
export default function AccountBlockedPage() {
  redirect("/account/status");
}
