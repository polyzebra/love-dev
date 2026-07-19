/**
 * P1.3 support platform - unit (no DB). Proves the public submission contract:
 * validation bounds, honeypot acceptance (bots are not tipped off), and the
 * source-level guarantees of the route (rate limit + honeypot + fail-closed)
 * and the service (persist BEFORE notify).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  supportRequestSchema,
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_LIMITS,
} from "../src/lib/support/schema";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const valid = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  category: "ACCOUNT" as const,
  message: "I cannot sign in and would like some help please.",
};

function main() {
  console.log("1. category contract");
  check("12 categories, all with labels", () => {
    assert.equal(SUPPORT_CATEGORIES.length, 12);
    for (const c of SUPPORT_CATEGORIES) {
      assert.ok(SUPPORT_CATEGORY_LABELS[c], `label for ${c}`);
    }
  });

  console.log("2. validation");
  check("a valid request parses", () => {
    assert.ok(supportRequestSchema.safeParse(valid).success);
  });
  check("missing name is rejected", () => {
    assert.equal(supportRequestSchema.safeParse({ ...valid, name: "" }).success, false);
  });
  check("invalid email is rejected", () => {
    assert.equal(supportRequestSchema.safeParse({ ...valid, email: "not-an-email" }).success, false);
  });
  check("a too-short message is rejected", () => {
    assert.equal(supportRequestSchema.safeParse({ ...valid, message: "hi" }).success, false);
  });
  check("an over-length message is rejected", () => {
    const long = "a".repeat(SUPPORT_LIMITS.message.max + 1);
    assert.equal(supportRequestSchema.safeParse({ ...valid, message: long }).success, false);
  });
  check("an unknown category is rejected", () => {
    assert.equal(supportRequestSchema.safeParse({ ...valid, category: "NONSENSE" }).success, false);
  });
  check("empty optional fields are accepted", () => {
    const r = supportRequestSchema.safeParse({ ...valid, accountEmail: "", reference: "" });
    assert.ok(r.success);
  });
  check("an invalid accountEmail is rejected", () => {
    assert.equal(
      supportRequestSchema.safeParse({ ...valid, accountEmail: "nope" }).success,
      false,
    );
  });

  console.log("3. honeypot never tips off a bot (schema accepts it)");
  check("a filled honeypot still passes schema (dropped later in the route)", () => {
    const r = supportRequestSchema.safeParse({ ...valid, website: "http://spam.example" });
    assert.ok(r.success, "honeypot value must not cause a validation error");
  });

  console.log("4. route source-contract");
  const route = readFileSync("src/app/api/support/route.ts", "utf8");
  check("route rate-limits, checks honeypot, and fails closed", () => {
    assert.ok(route.includes("guardRate"), "rate limited");
    assert.ok(route.includes("RATE_LIMITS.support"), "uses the fail-closed support preset");
    assert.ok(route.includes(".website"), "honeypot branch present");
    assert.ok(route.includes("internalError"), "persist failure -> 500 (no fake success)");
  });

  console.log("5. service persists BEFORE it notifies");
  const service = readFileSync("src/lib/services/support.ts", "utf8");
  check("db.supportRequest.create runs before notifyInbox", () => {
    const createAt = service.indexOf("db.supportRequest.create");
    const notifyAt = service.indexOf("await notifyInbox(");
    assert.ok(createAt > -1 && notifyAt > -1, "both present");
    assert.ok(createAt < notifyAt, "persist-first ordering");
  });
  check("a notify failure is caught, not thrown", () => {
    assert.ok(service.includes("request retained"), "notify failure logged + retained");
  });

  console.log(`\n${passed} checks passed`);
}

main();
