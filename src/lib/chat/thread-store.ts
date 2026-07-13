/**
 * Pure message-thread state transitions (Phase 0G) - framework-free so
 * the realtime safety rules are unit-testable without a browser:
 *
 *  - duplicates are safe: merging is keyed by message id, so the same
 *    event arriving twice (realtime + recovery fetch, replayed sends,
 *    multi-tab echoes) changes nothing the second time
 *  - out-of-order arrivals are safe: ordering is (createdAt, id) - the
 *    server's clock and a stable tiebreaker - never arrival order
 *  - receipts never regress: SENT -> DELIVERED -> SEEN is a one-way
 *    ladder, so a late "delivered" after "read" is a no-op
 *  - optimistic (pending) bubbles always render after settled history
 *    and survive merges untouched
 */

export type MessageStatus = "SENT" | "DELIVERED" | "SEEN";

export type ThreadMessage = {
  id: string;
  senderId: string;
  body: string | null;
  status: MessageStatus;
  createdAt: string | Date;
  pending?: boolean;
  /** Client-only: arrived while the thread was open, so animate its entrance.
      Messages present at mount (and confirmed sends) never carry it. */
  isNew?: boolean;
};

export type ReceiptEvent = {
  kind: "delivered" | "read";
  /** The participant whose device acknowledged - NOT the message sender. */
  byId: string;
};

const STATUS_RANK: Record<MessageStatus, number> = { SENT: 0, DELIVERED: 1, SEEN: 2 };

function ts(value: string | Date): number {
  return new Date(value).getTime();
}

/** Server ordering: createdAt, then id as a stable tiebreaker. */
export function compareMessages(a: ThreadMessage, b: ThreadMessage): number {
  return ts(a.createdAt) - ts(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** One-way status ladder - the higher state always wins. */
export function maxStatus(a: MessageStatus, b: MessageStatus): MessageStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

export type MergeOutcome = {
  messages: ThreadMessage[];
  /** Ids that were genuinely new to the thread. */
  addedIds: string[];
  /** Incoming rows whose id was already present (duplicate deliveries). */
  duplicateCount: number;
};

/**
 * Merge server rows into the thread. Settled rows are keyed by id;
 * incoming server rows win field-wise except that (a) the status ladder
 * never regresses and (b) the local `isNew` animation flag is preserved
 * for rows we already rendered. Pending optimistic bubbles pass through
 * untouched and stay at the tail.
 */
export function mergeMessages(prev: ThreadMessage[], incoming: ThreadMessage[]): MergeOutcome {
  const pending = prev.filter((m) => m.pending);
  const byId = new Map(prev.filter((m) => !m.pending).map((m) => [m.id, m]));
  const addedIds: string[] = [];
  let duplicateCount = 0;

  for (const raw of incoming) {
    if (raw.pending) continue; // never accept pending rows from outside
    const known = byId.get(raw.id);
    if (known) {
      duplicateCount += 1;
      byId.set(raw.id, {
        ...known,
        ...raw,
        status: maxStatus(known.status, raw.status),
        isNew: known.isNew,
      });
    } else {
      addedIds.push(raw.id);
      byId.set(raw.id, { ...raw, isNew: true });
    }
  }

  const settled = [...byId.values()].sort(compareMessages);
  return { messages: [...settled, ...pending], addedIds, duplicateCount };
}

/**
 * Confirm an optimistic send: replace the pending bubble with the server
 * row. If a realtime event or recovery fetch delivered the row first,
 * the pending bubble is simply dropped (dedupe by id).
 */
export function confirmPending(
  prev: ThreadMessage[],
  pendingId: string,
  confirmed: ThreadMessage,
): ThreadMessage[] {
  const settled: ThreadMessage = { ...confirmed, pending: false, isNew: false };
  const withoutPending = prev.filter((m) => m.id !== pendingId);
  if (withoutPending.some((m) => m.id === settled.id)) {
    return withoutPending.map((m) =>
      m.id === settled.id ? { ...m, ...settled, status: maxStatus(m.status, settled.status) } : m,
    );
  }
  return [...withoutPending, settled].sort(
    (a, b) => Number(a.pending ?? false) - Number(b.pending ?? false) || compareMessages(a, b),
  );
}

/**
 * Apply a receipt from another participant: everything THEY acknowledged
 * is a message they did not send - i.e. messages from everyone else
 * (in a 2-party thread: mine). read -> SEEN, delivered -> DELIVERED,
 * always through the one-way ladder so late events cannot regress state.
 */
export function applyReceipt(prev: ThreadMessage[], receipt: ReceiptEvent): ThreadMessage[] {
  const target: MessageStatus = receipt.kind === "read" ? "SEEN" : "DELIVERED";
  let changed = false;
  const next = prev.map((m) => {
    if (m.pending || m.senderId === receipt.byId) return m;
    const status = maxStatus(m.status, target);
    if (status === m.status) return m;
    changed = true;
    return { ...m, status };
  });
  return changed ? next : prev;
}
