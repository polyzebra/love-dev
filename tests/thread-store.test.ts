/**
 * Unit tests for the realtime thread-state rules (Phase 0G):
 *   npx tsx tests/thread-store.test.ts
 *
 * Pure - no DB, no env, no browser. Proves the safety rules the realtime
 * transport relies on: duplicate events are no-ops, out-of-order events
 * sort by server time, receipts never regress the status ladder, and
 * optimistic sends confirm/dedupe cleanly.
 */
import assert from "node:assert/strict";
import {
  applyReceipt,
  confirmPending,
  maxStatus,
  mergeMessages,
  type ThreadMessage,
} from "../src/lib/chat/thread-store";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const msg = (
  id: string,
  senderId: string,
  at: string,
  status: ThreadMessage["status"] = "SENT",
  extra: Partial<ThreadMessage> = {},
): ThreadMessage => ({ id, senderId, body: `b-${id}`, status, createdAt: at, ...extra });

console.log("merge semantics");

check("new rows are added and marked as fresh arrivals", () => {
  const out = mergeMessages(
    [msg("a", "u1", "2026-07-13T10:00:00Z")],
    [msg("b", "u2", "2026-07-13T10:01:00Z")],
  );
  assert.deepEqual(out.addedIds, ["b"]);
  assert.equal(out.duplicateCount, 0);
  assert.equal(out.messages.length, 2);
  assert.equal(out.messages[1].isNew, true, "arrival animates");
});

check("duplicate delivery is a counted no-op (same id twice)", () => {
  const first = mergeMessages([], [msg("a", "u1", "2026-07-13T10:00:00Z")]);
  const second = mergeMessages(first.messages, [msg("a", "u1", "2026-07-13T10:00:00Z")]);
  assert.equal(second.messages.length, 1);
  assert.deepEqual(second.addedIds, []);
  assert.equal(second.duplicateCount, 1);
});

check("out-of-order events end up in server order (createdAt, then id)", () => {
  const out = mergeMessages(
    [],
    [
      msg("late", "u1", "2026-07-13T10:05:00Z"),
      msg("early", "u2", "2026-07-13T10:01:00Z"),
      msg("b-tie", "u1", "2026-07-13T10:03:00Z"),
      msg("a-tie", "u2", "2026-07-13T10:03:00Z"),
    ],
  );
  assert.deepEqual(
    out.messages.map((m) => m.id),
    ["early", "a-tie", "b-tie", "late"],
  );
});

check("merge never regresses status (SEEN row + stale SENT copy)", () => {
  const seen = [msg("a", "u1", "2026-07-13T10:00:00Z", "SEEN")];
  const out = mergeMessages(seen, [msg("a", "u1", "2026-07-13T10:00:00Z", "SENT")]);
  assert.equal(out.messages[0].status, "SEEN");
});

check("pending optimistic bubbles survive merges and stay at the tail", () => {
  const prev = [
    msg("a", "u1", "2026-07-13T10:00:00Z"),
    msg("pending-1", "u1", "2026-07-13T10:06:00Z", "SENT", { pending: true }),
  ];
  const out = mergeMessages(prev, [msg("b", "u2", "2026-07-13T10:01:00Z")]);
  assert.deepEqual(
    out.messages.map((m) => m.id),
    ["a", "b", "pending-1"],
  );
  assert.equal(out.messages[2].pending, true);
});

console.log("optimistic confirmation");

check("confirm swaps the pending bubble for the server row", () => {
  const prev = [msg("pending-1", "u1", "2026-07-13T10:00:00Z", "SENT", { pending: true })];
  const next = confirmPending(prev, "pending-1", msg("real-1", "u1", "2026-07-13T10:00:01Z"));
  assert.deepEqual(
    next.map((m) => m.id),
    ["real-1"],
  );
  assert.equal(next[0].pending, false);
  assert.equal(next[0].isNew, false, "confirmed send never re-animates");
});

check("confirm dedupes when realtime delivered the row first", () => {
  const prev = [
    msg("real-1", "u1", "2026-07-13T10:00:01Z", "SEEN"),
    msg("pending-1", "u1", "2026-07-13T10:00:00Z", "SENT", { pending: true }),
  ];
  const next = confirmPending(prev, "pending-1", msg("real-1", "u1", "2026-07-13T10:00:01Z"));
  assert.equal(next.length, 1);
  assert.equal(next[0].status, "SEEN", "existing higher status kept");
});

console.log("receipt ladder");

check("read receipt from the other side marks MY messages SEEN", () => {
  const prev = [
    msg("mine", "me", "2026-07-13T10:00:00Z", "SENT"),
    msg("theirs", "them", "2026-07-13T10:01:00Z", "SENT"),
  ];
  const next = applyReceipt(prev, { kind: "read", byId: "them" });
  assert.equal(next.find((m) => m.id === "mine")?.status, "SEEN");
  assert.equal(next.find((m) => m.id === "theirs")?.status, "SENT", "their own rows untouched");
});

check("delivered receipt upgrades SENT but NEVER regresses SEEN (out-of-order)", () => {
  const prev = [
    msg("m1", "me", "2026-07-13T10:00:00Z", "SEEN"),
    msg("m2", "me", "2026-07-13T10:01:00Z", "SENT"),
  ];
  const next = applyReceipt(prev, { kind: "delivered", byId: "them" });
  assert.equal(next.find((m) => m.id === "m1")?.status, "SEEN", "late delivered is a no-op");
  assert.equal(next.find((m) => m.id === "m2")?.status, "DELIVERED");
});

check("no-op receipts return the SAME array (no wasted renders)", () => {
  const prev = [msg("m1", "me", "2026-07-13T10:00:00Z", "SEEN")];
  assert.equal(applyReceipt(prev, { kind: "delivered", byId: "them" }), prev);
});

check("status ladder is total and one-way", () => {
  assert.equal(maxStatus("SENT", "DELIVERED"), "DELIVERED");
  assert.equal(maxStatus("SEEN", "DELIVERED"), "SEEN");
  assert.equal(maxStatus("SENT", "SEEN"), "SEEN");
});

console.log(`\n${passed} checks passed`);
