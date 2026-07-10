/**
 * Tests for the per-workflow phone-country allowlists
 * (src/lib/auth/phone-countries.ts) and their enforcement in BOTH server
 * flows. Run with:
 *   npx tsx tests/phone-countries.test.ts
 *
 * Sections 1-3 are pure env manipulation (no DB). Section 4 talks to the
 * real database from .env for the one positive case that must reach a
 * (spy) provider; its user and audit events are namespaced per run and
 * removed in `finally`. SMS never leaves the building.
 *
 * The matrix:
 *   1. Parsing: unset -> hard default IE,GB; trim/uppercase/dedupe;
 *      junk codes filtered against the shared dataset; an all-junk env
 *      counts as unconfigured; env order preserved (first = UI default)
 *   2. Fallback chain: login never widens; verification defaults to the
 *      change list; change falls back verification -> login -> IE,GB;
 *      env isolation - changing PHONE_LOGIN_COUNTRIES never moves the
 *      change list and vice versa (fresh read per call, no caching)
 *   3. Server authority, rejection side: login flow (send + verify) and
 *      change flow (send + verify) reject a country outside THEIR list
 *      with unsupported_country and ZERO provider/client calls
 *   4. Server authority, positive side: widening ONLY the change list
 *      lets the change flow send to a US number while the login flow
 *      still rejects it (per-workflow isolation end to end)
 *   5. E.164 normalization equivalence (cites phone-verification.test.ts
 *      case 7, kept in both suites): 0868672333 / 353868672333 /
 *      +353868672333 -> one +353868672333
 *   6. UI contract: the /auth/phone and /login/phone pages pass
 *      workflowCountries(...) into CountryCodeSheet's `isos`; a DOM
 *      render is impractical under tsx, so we assert the exact filter
 *      the sheet applies over the shared dataset yields one row per
 *      allowlisted ISO and that the first entry is a valid UI default.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";

const RUN = Date.now().toString(36);

// Valid numbers reserved for this suite (never real users').
const NUMBERS = {
  us: "+12025550166",
  gb: "+447400123456",
  ie: "+353868672333",
} as const;

const ENV_KEYS = [
  "PHONE_LOGIN_COUNTRIES",
  "PHONE_VERIFICATION_COUNTRIES",
  "PHONE_CHANGE_COUNTRIES",
] as const;

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
}

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  const { workflowCountries, workflowCountrySet } = await import(
    "../src/lib/auth/phone-countries"
  );
  const { COUNTRIES, countryByIso, matchesCountry } = await import("../src/lib/auth/countries");
  const { sendPhoneVerification, confirmPhoneVerification, normalizePhone } = await import(
    "../src/lib/auth/phone-flow"
  );
  const { sendPhoneLoginCode, verifyPhoneLoginCode } = await import(
    "../src/lib/auth/phone-login-flow"
  );
  const { db } = await import("../src/lib/db");
  type Provider = import("../src/lib/auth/phone").PhoneVerificationProvider;
  type AuthClient = import("../src/lib/auth/phone-login-flow").PhoneLoginAuthClient;

  function spyProvider() {
    const calls: { method: "send" | "verify"; phoneE164: string }[] = [];
    const provider: Provider = {
      async sendCode(phoneE164) {
        calls.push({ method: "send", phoneE164 });
      },
      async verifyCode(phoneE164) {
        calls.push({ method: "verify", phoneE164 });
        return "approved";
      },
    };
    return { provider, calls };
  }

  function spyClient() {
    const calls: { method: string }[] = [];
    const client: AuthClient = {
      async signInWithOtp() {
        calls.push({ method: "signInWithOtp" });
        return { error: null };
      },
      async verifyOtp() {
        calls.push({ method: "verifyOtp" });
        return { data: { user: { id: randomUUID() }, session: {} }, error: null };
      },
      async signOut() {
        calls.push({ method: "signOut" });
        return { error: null };
      },
    };
    return { client, calls };
  }

  const sessionUser = (id: string) => ({ id, bannedAt: null, status: "ACTIVE" });
  const kinds = ["login", "verification", "change"] as const;

  try {
    // ------------------------------------------------------------ case 1
    console.log("1. parsing + hard default");
    await check("all three unset -> IE,GB for every workflow (NEVER all countries)", () => {
      setEnv({});
      for (const kind of kinds) {
        assert.deepEqual(workflowCountries(kind), ["IE", "GB"], kind);
      }
    });
    await check("trim/uppercase/dedupe; junk ISO codes filtered via the shared dataset", () => {
      setEnv({ PHONE_LOGIN_COUNTRIES: " ie , gb ,GB, ZZ ,123,Q,USA,us," });
      // "US" never appears (only "us" -> US does; USA/ZZ/123/Q are junk)
      assert.deepEqual(workflowCountries("login"), ["IE", "GB", "US"]);
    });
    await check("an env that parses to nothing counts as unconfigured", () => {
      setEnv({ PHONE_LOGIN_COUNTRIES: "ZZ,XX, ,123" });
      assert.deepEqual(workflowCountries("login"), ["IE", "GB"], "falls to the hard default");
      setEnv({ PHONE_CHANGE_COUNTRIES: "ZZ", PHONE_LOGIN_COUNTRIES: "IE" });
      assert.deepEqual(workflowCountries("change"), ["IE"], "junk change env falls to login");
    });
    await check("env order preserved - first entry is the UI's default country", () => {
      setEnv({ PHONE_LOGIN_COUNTRIES: "GB,IE" });
      assert.deepEqual(workflowCountries("login"), ["GB", "IE"]);
    });

    // ------------------------------------------------------------ case 2
    console.log("2. fallback chain + env isolation");
    await check("only LOGIN set -> verification and change inherit it", () => {
      setEnv({ PHONE_LOGIN_COUNTRIES: "IE" });
      for (const kind of kinds) assert.deepEqual(workflowCountries(kind), ["IE"], kind);
    });
    await check("only VERIFICATION set -> change inherits it; login stays strict", () => {
      setEnv({ PHONE_VERIFICATION_COUNTRIES: "IE,GB,US" });
      assert.deepEqual(workflowCountries("verification"), ["IE", "GB", "US"]);
      assert.deepEqual(workflowCountries("change"), ["IE", "GB", "US"]);
      assert.deepEqual(workflowCountries("login"), ["IE", "GB"], "login never widens");
    });
    await check("only CHANGE set -> verification defaults to the change list; login stays strict", () => {
      setEnv({ PHONE_CHANGE_COUNTRIES: "IE,GB,US" });
      assert.deepEqual(workflowCountries("change"), ["IE", "GB", "US"]);
      assert.deepEqual(workflowCountries("verification"), ["IE", "GB", "US"]);
      assert.deepEqual(workflowCountries("login"), ["IE", "GB"]);
    });
    await check("all three set -> each workflow reads exactly its own env", () => {
      setEnv({
        PHONE_LOGIN_COUNTRIES: "IE",
        PHONE_VERIFICATION_COUNTRIES: "IE,GB",
        PHONE_CHANGE_COUNTRIES: "IE,GB,US",
      });
      assert.deepEqual(workflowCountries("login"), ["IE"]);
      assert.deepEqual(workflowCountries("verification"), ["IE", "GB"]);
      assert.deepEqual(workflowCountries("change"), ["IE", "GB", "US"]);
    });
    await check("env isolation: moving LOGIN never moves CHANGE and vice versa", () => {
      setEnv({ PHONE_LOGIN_COUNTRIES: "IE", PHONE_CHANGE_COUNTRIES: "IE,GB,US" });
      assert.deepEqual(workflowCountries("change"), ["IE", "GB", "US"]);
      process.env.PHONE_LOGIN_COUNTRIES = "GB"; // fresh read per call - no cache
      assert.deepEqual(workflowCountries("login"), ["GB"]);
      assert.deepEqual(workflowCountries("change"), ["IE", "GB", "US"], "change unmoved");
      process.env.PHONE_CHANGE_COUNTRIES = "IE";
      assert.deepEqual(workflowCountries("login"), ["GB"], "login unmoved");
      assert.deepEqual(workflowCountries("change"), ["IE"]);
      assert.ok(workflowCountrySet("login").has("GB"), "set view agrees");
    });

    // ------------------------------------------------------------ case 3
    console.log("3. server authority - rejections before any provider/client call");
    process.env.PHONE_LOGIN_ENABLED = "true";
    await check("login flow: GB outside PHONE_LOGIN_COUNTRIES=IE -> unsupported_country, zero client calls", async () => {
      setEnv({ PHONE_LOGIN_COUNTRIES: "IE" });
      const spy = spyClient();
      const sent = await sendPhoneLoginCode({ phone: NUMBERS.gb, client: spy.client });
      assert.equal(sent.kind, "unsupported_country");
      const verified = await verifyPhoneLoginCode({
        phone: NUMBERS.gb,
        code: "123456",
        client: spy.client,
      });
      assert.equal(verified.kind, "unsupported_country");
      assert.equal(spy.calls.length, 0, "client must never be reached");
    });
    await check("change flow: US outside the default change list -> unsupported_country, zero provider calls", async () => {
      setEnv({}); // change falls all the way to IE,GB
      const spy = spyProvider();
      const sent = await sendPhoneVerification({
        user: sessionUser(randomUUID()),
        phone: NUMBERS.us,
        provider: spy.provider,
      });
      assert.equal(sent.kind, "unsupported_country");
      const verified = await confirmPhoneVerification({
        user: { id: randomUUID() },
        phone: NUMBERS.us,
        code: "123456",
        provider: spy.provider,
      });
      assert.equal(verified.kind, "unsupported_country");
      assert.equal(spy.calls.length, 0, "provider must never be reached - no SMS");
    });

    // ------------------------------------------------------------ case 4
    console.log("4. per-workflow isolation end to end (DB-backed positive case)");
    const userId = randomUUID();
    await db.user.create({
      data: { id: userId, email: `phone-countries-${RUN}@example.com` },
    });
    await check("widening ONLY the change list admits US there while login still rejects it", async () => {
      setEnv({ PHONE_LOGIN_COUNTRIES: "IE,GB", PHONE_CHANGE_COUNTRIES: "IE,GB,US" });
      const provider = spyProvider();
      const sent = await sendPhoneVerification({
        user: sessionUser(userId),
        phone: NUMBERS.us,
        provider: provider.provider,
      });
      assert.equal(sent.kind, "sent", "change flow accepts US from ITS list");
      assert.deepEqual(provider.calls, [{ method: "send", phoneE164: NUMBERS.us }]);

      const client = spyClient();
      const login = await sendPhoneLoginCode({ phone: NUMBERS.us, client: client.client });
      assert.equal(login.kind, "unsupported_country", "login list is untouched by the change env");
      assert.equal(client.calls.length, 0);
    });

    // ------------------------------------------------------------ case 5
    console.log("5. E.164 normalization equivalence (also phone-verification.test.ts case 7)");
    await check("0868672333 / 353868672333 / +353868672333 -> one +353868672333", () => {
      setEnv({});
      for (const input of ["0868672333", "353868672333", "+353868672333"]) {
        const n = normalizePhone(input, "IE");
        assert.ok(n.ok, `${input} should normalize`);
        assert.equal(n.phoneE164, NUMBERS.ie);
        assert.equal(n.countryIso, "IE");
      }
    });

    // ------------------------------------------------------------ case 6
    console.log("6. UI contract - allowlist -> CountryCodeSheet isos filter");
    await check("the sheet's isos filter over the shared dataset yields one row per enabled ISO", () => {
      setEnv({});
      for (const kind of kinds) {
        const isos = workflowCountries(kind);
        // Exactly what CountryCodeSheet does in restricted mode.
        const allowed = new Set(isos.map((iso) => iso.toUpperCase()));
        const rows = COUNTRIES.filter((c) => allowed.has(c.iso));
        assert.equal(rows.length, isos.length, `${kind}: every enabled ISO renders exactly once`);
        // First entry is the pages' default country (IE by default).
        const fallback = countryByIso(isos[0]);
        assert.ok(fallback, "default country resolves in the dataset");
        assert.equal(fallback.iso, "IE");
      }
    });

    await check("sheet search matches name AND dial code with or without '+'", () => {
      const ie = countryByIso("IE")!;
      const gb = countryByIso("GB")!;
      for (const q of ["353", "+353", "Ireland", "irela", "IE"]) {
        assert.ok(matchesCountry(ie, q), `IE should match "${q}"`);
      }
      for (const q of ["44", "+44", "United Kingdom", "united k"]) {
        assert.ok(matchesCountry(gb, q), `GB should match "${q}"`);
      }
      assert.ok(!matchesCountry(ie, "44"), "IE must not match GB's dial code");
      assert.ok(!matchesCountry(gb, "Ireland"), "GB must not match Ireland");
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    await db.user
      .deleteMany({ where: { email: { contains: `phone-countries-${RUN}` } } })
      .catch(() => {});
    await db.authVerificationEvent
      .deleteMany({ where: { phoneE164: NUMBERS.us } })
      .catch(() => {});
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nTEST FAILURE:", error);
  process.exit(1);
});
