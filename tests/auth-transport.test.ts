/**
 * Unit tests for the authentication transport decision matrix
 * (src/lib/auth/transport.ts). Pure - no DB, no env, no server:
 *   npx tsx tests/auth-transport.test.ts
 *
 * The rules under test (Phase 0C):
 *  - malformed Authorization headers REJECT, never fall back to cookies
 *  - invalid bearer tokens REJECT, never fall back to cookies
 *  - conflicting cookie/bearer identities REJECT
 *  - matching identities proceed as bearer
 *  - cookie-only behaviour is unchanged
 */
import assert from "node:assert/strict";
import { decideIdentity, parseAuthorizationHeader } from "../src/lib/auth/transport";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log("parseAuthorizationHeader");

check("absent/empty/whitespace headers parse as none", () => {
  for (const h of [null, undefined, "", "   "]) {
    assert.deepEqual(parseAuthorizationHeader(h), { kind: "none" }, JSON.stringify(h));
  }
});

check("well-formed Bearer parses (scheme case-insensitive, padding tolerated)", () => {
  assert.deepEqual(parseAuthorizationHeader("Bearer abc.def.ghi"), {
    kind: "token",
    token: "abc.def.ghi",
  });
  assert.deepEqual(parseAuthorizationHeader("bearer tok123"), { kind: "token", token: "tok123" });
  assert.deepEqual(parseAuthorizationHeader("  Bearer   tok  "), {
    kind: "token",
    token: "tok",
  });
});

check("everything else present-but-unusable is malformed", () => {
  for (const h of ["Bearer", "Bearer ", "Bearer a b", "Basic dXNlcjpwdw==", "Token abc", "abc"]) {
    assert.deepEqual(parseAuthorizationHeader(h), { kind: "malformed" }, h);
  }
});

console.log("decideIdentity matrix");

const token = { kind: "token" as const, token: "t" };
const none = { kind: "none" as const };
const malformed = { kind: "malformed" as const };

check("no credentials at all -> no_credentials", () => {
  assert.deepEqual(
    decideIdentity({ bearer: none, bearerUserId: null, cookieUserId: null, hasCookieCredentials: false }),
    { ok: false, reason: "no_credentials" },
  );
});

check("cookie-only valid session -> cookie transport (behaviour unchanged)", () => {
  assert.deepEqual(
    decideIdentity({ bearer: none, bearerUserId: null, cookieUserId: "u1", hasCookieCredentials: true }),
    { ok: true, transport: "cookie" },
  );
});

check("cookie credentials present but unresolvable -> invalid_cookie", () => {
  assert.deepEqual(
    decideIdentity({ bearer: none, bearerUserId: null, cookieUserId: null, hasCookieCredentials: true }),
    { ok: false, reason: "invalid_cookie" },
  );
});

check("malformed Authorization rejects EVEN WITH a valid cookie session", () => {
  assert.deepEqual(
    decideIdentity({ bearer: malformed, bearerUserId: null, cookieUserId: "u1", hasCookieCredentials: true }),
    { ok: false, reason: "malformed_authorization" },
  );
});

check("invalid/expired bearer rejects EVEN WITH a valid cookie session", () => {
  assert.deepEqual(
    decideIdentity({ bearer: token, bearerUserId: null, cookieUserId: "u1", hasCookieCredentials: true }),
    { ok: false, reason: "invalid_bearer" },
  );
});

check("valid bearer with no cookies -> bearer transport", () => {
  assert.deepEqual(
    decideIdentity({ bearer: token, bearerUserId: "u1", cookieUserId: null, hasCookieCredentials: false }),
    { ok: true, transport: "bearer" },
  );
});

check("matching cookie and bearer identities -> bearer proceeds", () => {
  assert.deepEqual(
    decideIdentity({ bearer: token, bearerUserId: "u1", cookieUserId: "u1", hasCookieCredentials: true }),
    { ok: true, transport: "bearer" },
  );
});

check("CONFLICTING cookie and bearer identities -> reject, never pick one", () => {
  assert.deepEqual(
    decideIdentity({ bearer: token, bearerUserId: "u1", cookieUserId: "u2", hasCookieCredentials: true }),
    { ok: false, reason: "conflicting_identities" },
  );
});

check("valid bearer alongside stale/unresolvable cookies -> bearer proceeds", () => {
  assert.deepEqual(
    decideIdentity({ bearer: token, bearerUserId: "u1", cookieUserId: null, hasCookieCredentials: true }),
    { ok: true, transport: "bearer" },
  );
});

console.log(`\n${passed} checks passed`);
