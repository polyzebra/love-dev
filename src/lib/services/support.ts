import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { pickEmailProvider, type EmailMessage } from "@/lib/services/email";
import type { SupportCategory, SupportStatus, SupportPriority } from "@/generated/prisma/enums";
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_LIMITS,
  type SupportRequestInput,
} from "@/lib/support/schema";

/**
 * Support platform service (P1.3). The public contract is: PERSIST FIRST,
 * NOTIFY SECOND. A request is written to the database before any email is
 * attempted, and a notification failure NEVER fails the request or loses it -
 * it is retained with emailDelivered=false for retry/manual follow-up. The
 * only failure that reaches the user is a persistence failure (fail closed:
 * no request stored -> honest error, never a fake success). The client-safe
 * contract (categories, labels, bounds, schema) lives in lib/support/schema.
 */

/** The single internal inbox notified for a new request. Never returned to the client. */
export const SUPPORT_INBOX = "info@tirvea.com";

/**
 * Strip control characters (keep tab and newline), normalise line endings,
 * trim, and cap. A code-point filter avoids embedding control bytes in source.
 */
function sanitizeText(value: string, max: number): string {
  const normalized = value.replace(/\r\n?/g, "\n");
  let out = "";
  for (const ch of normalized) {
    const code = ch.codePointAt(0) ?? 0;
    const isTabOrNewline = code === 9 || code === 10;
    const isPrintable = code >= 32 && code !== 127;
    if (isTabOrNewline || isPrintable) out += ch;
  }
  return out.trim().slice(0, max);
}

/** Single-line fields must not carry newlines (email-header-injection safe). */
function sanitizeLine(value: string, max: number): string {
  return sanitizeText(value, max).replace(/\n+/g, " ").trim();
}

const DEDUPE_WINDOW_MS = 10 * 60_000;

function dedupeHashOf(email: string, message: string): string {
  return createHash("sha256")
    .update(`${email.toLowerCase()}::${message.trim().replace(/\s+/g, " ")}`)
    .digest("hex");
}

/** Default priority: SAFETY is triaged higher; everything else NORMAL. */
function defaultPriority(category: SupportCategory): SupportPriority {
  return category === "SAFETY" ? "HIGH" : "NORMAL";
}

export type CreateSupportResult = { id: string; deduped: boolean };

/**
 * Persist a support request, then best-effort notify the inbox. Throws only on
 * a persistence failure (the route maps that to a 500 - no fake success).
 */
export async function createSupportRequest(
  input: SupportRequestInput,
  ctx: { ipHash: string | null; userId: string | null },
): Promise<CreateSupportResult> {
  const name = sanitizeLine(input.name, SUPPORT_LIMITS.name.max);
  const email = sanitizeLine(input.email, SUPPORT_LIMITS.email.max).toLowerCase();
  const message = sanitizeText(input.message, SUPPORT_LIMITS.message.max);
  const accountEmail = input.accountEmail
    ? sanitizeLine(input.accountEmail, SUPPORT_LIMITS.accountEmail.max).toLowerCase()
    : null;
  const reference = input.reference
    ? sanitizeLine(input.reference, SUPPORT_LIMITS.reference.max)
    : null;
  const dedupeHash = dedupeHashOf(email, message);

  // Idempotency: an identical (email+message) request inside the window
  // returns the existing id instead of storing/emailing again.
  const recent = await db.supportRequest.findFirst({
    where: { dedupeHash, createdAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (recent) return { id: recent.id, deduped: true };

  // PERSIST FIRST - this is the durable record; if it throws, the caller fails.
  const request = await db.supportRequest.create({
    data: {
      category: input.category,
      priority: defaultPriority(input.category),
      name,
      email,
      accountEmail,
      reference,
      message,
      ipHash: ctx.ipHash,
      userId: ctx.userId,
      dedupeHash,
    },
    select: { id: true },
  });

  // NOTIFY SECOND - best effort. A failure is logged and the request is kept
  // (emailDelivered stays false); it is never surfaced to the user as failure.
  await notifyInbox({
    id: request.id,
    category: input.category,
    name,
    email,
    accountEmail,
    reference,
    message,
  });

  return { id: request.id, deduped: false };
}

async function notifyInbox(r: {
  id: string;
  category: SupportCategory;
  name: string;
  email: string;
  accountEmail: string | null;
  reference: string | null;
  message: string;
}): Promise<void> {
  const provider = pickEmailProvider();
  if (!provider.configured) {
    console.warn(`[support] email provider not configured - request ${r.id} stored, not notified`);
    return;
  }
  const subject = `[Support] ${SUPPORT_CATEGORY_LABELS[r.category]} - ${r.reference ?? r.id}`;
  const text = [
    `New support request (${r.id})`,
    `Category: ${SUPPORT_CATEGORY_LABELS[r.category]}`,
    `From: ${r.name} <${r.email}>`,
    r.accountEmail ? `Account email: ${r.accountEmail}` : null,
    r.reference ? `Reference: ${r.reference}` : null,
    "",
    r.message,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
  const message: EmailMessage = { to: SUPPORT_INBOX, subject, text };
  try {
    const result = await provider.send(message);
    if (result.ok) {
      await db.supportRequest.update({ where: { id: r.id }, data: { emailDelivered: true } });
    } else {
      console.warn(`[support] notify failed for ${r.id}: ${result.errorCode} (request retained)`);
    }
  } catch (error) {
    console.error(`[support] notify threw for ${r.id} (request retained):`, error);
  }
}

// --------------------------------------------------------------------------
// Admin queue helpers (staff-only callers).
// --------------------------------------------------------------------------

export type SupportListFilters = {
  status?: SupportStatus | "open" | "all";
  category?: SupportCategory;
  assignedAdmin?: string;
  includeSpam?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
};

const OPEN_STATUSES: SupportStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_USER"];

export async function listSupportRequests(filters: SupportListFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
  const where: Record<string, unknown> = {};
  if (!filters.includeSpam) where.spam = false;
  if (filters.status && filters.status !== "all") {
    where.status = filters.status === "open" ? { in: OPEN_STATUSES } : filters.status;
  }
  if (filters.category) where.category = filters.category;
  if (filters.assignedAdmin) where.assignedAdmin = filters.assignedAdmin;
  if (filters.search) {
    const q = filters.search.trim().slice(0, 120);
    where.OR = [
      { email: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { reference: { contains: q, mode: "insensitive" } },
      { accountEmail: { contains: q, mode: "insensitive" } },
    ];
  }
  const [rows, total] = await Promise.all([
    db.supportRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.supportRequest.count({ where }),
  ]);
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function getSupportRequest(id: string) {
  return db.supportRequest.findUnique({
    where: { id },
    include: { notes: { orderBy: { createdAt: "asc" } } },
  });
}

export type SupportPatch = {
  status?: SupportStatus;
  priority?: SupportPriority;
  assignedAdmin?: string | null;
  spam?: boolean;
};

export async function updateSupportRequest(id: string, patch: SupportPatch) {
  const data: Record<string, unknown> = { ...patch };
  if (patch.status === "CLOSED" || patch.status === "RESOLVED") data.closedAt = new Date();
  if (patch.status && patch.status !== "CLOSED" && patch.status !== "RESOLVED") {
    data.closedAt = null;
  }
  return db.supportRequest.update({ where: { id }, data });
}

export function addSupportNote(requestId: string, authorId: string | null, body: string) {
  return db.supportNote.create({
    data: { requestId, authorId, body: sanitizeText(body, 4000) },
  });
}

export function openSupportCount() {
  return db.supportRequest.count({ where: { spam: false, status: { in: OPEN_STATUSES } } });
}
