/**
 * Live tests for the Settings > Sign-in methods audit trail. Run with:
 *   npx tsx tests/identity-event.test.ts
 *
 * Covers the pure route logic (schema + action -> event-type mapping)
 * and the recordAuthEvent write the route performs, against the real
 * database from .env. Rows are namespaced under a test-specific email
 * and cleaned up in `finally`. requireSession itself needs a Next
 * request scope (Supabase cookies) so the auth guard is exercised by
 * build/typecheck + the shared requireSession helper's own coverage,
 * not here.
 */
import "dotenv/config";
import assert from "node:assert/strict";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";

const RUN = Date.now().toString(36);
const TEST_EMAIL = `identity-event-${RUN}@example.com`;

let passed = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> | void {
  const done = () => {
    passed += 1;
    console.log(`  ok - ${name}`);
  };
  const result = fn();
  if (result instanceof Promise) return result.then(done);
  done();
}

function fakeReq(ip = "203.0.113.7", ua = "test-agent/1.0"): Request {
  return new Request("http://test.local/api/auth/identity-event", {
    headers: { "x-forwarded-for": `${ip}, 10.0.0.1`, "user-agent": ua },
  });
}

async function main() {
  const { identityEventSchema, identityEventType } = await import(
    "../src/lib/validators/identity-event"
  );
  const { recordAuthEvent } = await import("../src/lib/auth/audit");
  const { db } = await import("../src/lib/db");

  try {
    // -------------------------------------------------------------- schema
    console.log("identity-event schema");
    await check("accepts both actions, with and without provider", () => {
      assert.equal(identityEventSchema.safeParse({ action: "link_started" }).success, true);
      assert.equal(
        identityEventSchema.safeParse({ action: "unlink", provider: "google" }).success,
        true,
      );
    });
    await check("rejects unknown actions, empty/oversized providers", () => {
      assert.equal(identityEventSchema.safeParse({ action: "delete" }).success, false);
      assert.equal(identityEventSchema.safeParse({}).success, false);
      assert.equal(
        identityEventSchema.safeParse({ action: "unlink", provider: "" }).success,
        false,
      );
      assert.equal(
        identityEventSchema.safeParse({ action: "unlink", provider: "x".repeat(33) }).success,
        false,
      );
    });

    // ------------------------------------------------------------- mapping
    console.log("action -> event type mapping");
    await check("link_started -> auth_identity_linked, unlink -> auth_identity_unlinked", () => {
      assert.equal(identityEventType("link_started"), "auth_identity_linked");
      assert.equal(identityEventType("unlink"), "auth_identity_unlinked");
    });

    // ----------------------------------------------------- live event write
    console.log("recordAuthEvent write (live DB)");
    await check("writes the row the route records, with hashed req identifiers", async () => {
      await recordAuthEvent({
        type: identityEventType("unlink"),
        email: TEST_EMAIL,
        req: fakeReq(),
        metadata: { provider: "google", source: "settings:sign-in-methods" },
      });
      const row = await db.authVerificationEvent.findFirst({
        where: { email: TEST_EMAIL },
      });
      assert.ok(row, "expected an AuthVerificationEvent row");
      assert.equal(row.type, "auth_identity_unlinked");
      assert.ok(row.ipHash && row.ipHash.length === 64, "ip is stored as a sha256 hash");
      assert.ok(row.userAgentHash && row.userAgentHash.length === 64, "ua is hashed");
      const metadata = row.metadata as { provider?: string; source?: string };
      assert.equal(metadata.provider, "google");
      assert.equal(metadata.source, "settings:sign-in-methods");
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    const { db } = await import("../src/lib/db");
    await db.authVerificationEvent.deleteMany({ where: { email: TEST_EMAIL } });
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
