/**
 * Tests for the shared phone-country support model
 * (src/lib/auth/phone-countries.ts) and its enforcement in BOTH server
 * flows. Run with:
 *   npx tsx tests/phone-countries.test.ts
 *
 * Sections 1-3 and 6-7 are pure env/source manipulation (no DB).
 * Section 4 talks to the real database from .env for the positive cases
 * that must reach a (spy) provider/client; its user and audit events are
 * namespaced per run and removed in `finally`. SMS never leaves the
 * building.
 *
 * The model under test: BASE = SUPPORTED_PHONE_COUNTRIES (parsed,
 * deduped, dataset-filtered) or, when unset/empty/junk, EVERY country in
 * the shared dataset (Twilio Verify = worldwide). Per-workflow envs
 * (PHONE_LOGIN/VERIFICATION/CHANGE_COUNTRIES) only NARROW:
 * intersection(base, override), never widening, empty intersection
 * ignored. No hard-coded country default exists anywhere.
 *
 * The matrix:
 *   1. Default: no envs -> login/verification/change all resolve to the
 *      IDENTICAL full dataset list (245 entries, alphabetical by name)
 *   2. SUPPORTED_PHONE_COUNTRIES narrows ALL workflows identically;
 *      parsing: trim/uppercase/dedupe, junk filtered via the dataset,
 *      env order preserved, all-junk counts as unconfigured
 *   3. Per-workflow overrides narrow ONLY their workflow via
 *      intersection with the base (outside-base codes dropped; an
 *      override entirely outside the base is ignored)
 *   4. Server authority: under the full default BOTH flows now accept a
 *      previously-excluded US number (spy provider/client - no SMS);
 *      explicit narrowing makes them reject it pre-provider again
 *   5. E.164 normalization equivalence (cites phone-verification.test.ts
 *      case 7): 0868672333 / 353868672333 / +353868672333 -> one
 *      +353868672333
 *   6. Single source of truth: the pages' prop and the flows' validation
 *      resolve from the SAME module/function (source-level assertion),
 *      and no second country-env parser or country array exists in src/
 *   7. UI contract: the sheet's Popular-pinned + alphabetical-rest
 *      filter over the full list covers every dataset country exactly
 *      once; name/dial search still matches. 245 flat 44px rows need no
 *      virtualization - render and scroll cost is trivial at this size,
 *      and a plain list keeps find-in-page and the roving tabindex
 *      simple.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";

const RUN = Date.now().toString(36);

// Valid numbers reserved for this suite (never real users').
const NUMBERS = {
  usChange: "+12025550166",
  usLogin: "+12025550188",
  ie: "+353868672333",
} as const;

const ENV_KEYS = [
  "SUPPORTED_PHONE_COUNTRIES",
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

const SRC = path.join(__dirname, "..", "src");
function srcFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return srcFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

async function main() {
  const { getSupportedPhoneCountries, getSupportedPhoneCountrySet } = await import(
    "../src/lib/auth/phone-countries"
  );
  const { COUNTRIES, POPULAR_COUNTRIES, countryByIso, matchesCountry } = await import(
    "../src/lib/auth/countries"
  );
  const { sendPhoneVerification, normalizePhone } = await import("../src/lib/auth/phone-flow");
  const { sendPhoneLoginCode, verifyPhoneLoginCode } = await import(
    "../src/lib/auth/phone-login-flow"
  );
  const { db } = await import("../src/lib/db");
  type Provider = import("../src/lib/auth/phone").PhoneVerificationProvider;
  type AuthClient = import("../src/lib/auth/phone-login-flow").PhoneLoginAuthClient;

  const FULL_LIST = COUNTRIES.map((c) => c.iso as string);
  const kinds = ["login", "verification", "change"] as const;

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

  try {
    // ------------------------------------------------------------ case 1
    console.log("1. default = the FULL dataset, identical for every workflow");
    await check("no envs -> all three workflows return the identical 245-entry list", () => {
      setEnv({});
      assert.equal(COUNTRIES.length, 245, "the shared dataset itself");
      for (const kind of kinds) {
        const list = getSupportedPhoneCountries(kind);
        assert.equal(list.length, COUNTRIES.length, `${kind}: full dataset length`);
        assert.deepEqual(list, FULL_LIST, `${kind}: exactly the dataset, dataset order`);
      }
      assert.deepEqual(
        getSupportedPhoneCountries("login"),
        getSupportedPhoneCountries("verification"),
        "login === verification",
      );
      assert.deepEqual(
        getSupportedPhoneCountries("login"),
        getSupportedPhoneCountries("change"),
        "login === change",
      );
    });
    await check("the full default includes previously-excluded countries (US, DE, LV)", () => {
      setEnv({});
      for (const iso of ["US", "DE", "LV", "IE", "GB"]) {
        assert.ok(getSupportedPhoneCountrySet("login").has(iso), `login has ${iso}`);
      }
    });
    await check("list is alphabetical by English name (UI order; sheet pins Popular)", () => {
      setEnv({});
      const names = getSupportedPhoneCountries("login").map((iso) => countryByIso(iso)!.name);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      assert.deepEqual(names, sorted);
    });

    // ------------------------------------------------------------ case 2
    console.log("2. SUPPORTED_PHONE_COUNTRIES - the ONE shared base");
    await check("SUPPORTED_PHONE_COUNTRIES=IE,GB,US narrows all three workflows identically", () => {
      setEnv({ SUPPORTED_PHONE_COUNTRIES: "IE,GB,US" });
      for (const kind of kinds) {
        assert.deepEqual(getSupportedPhoneCountries(kind), ["IE", "GB", "US"], kind);
      }
    });
    await check("trim/uppercase/dedupe; junk ISO codes filtered via the shared dataset", () => {
      setEnv({ SUPPORTED_PHONE_COUNTRIES: " ie , gb ,GB, ZZ ,123,Q,USA,us," });
      // "US" appears once (only "us" -> US does; USA/ZZ/123/Q are junk)
      assert.deepEqual(getSupportedPhoneCountries("change"), ["IE", "GB", "US"]);
    });
    await check("env order preserved - first entry is the UI's default country", () => {
      setEnv({ SUPPORTED_PHONE_COUNTRIES: "GB,IE" });
      assert.deepEqual(getSupportedPhoneCountries("login"), ["GB", "IE"]);
    });
    await check("an all-junk base counts as unconfigured -> the full dataset", () => {
      setEnv({ SUPPORTED_PHONE_COUNTRIES: "ZZ,XX, ,123" });
      assert.deepEqual(getSupportedPhoneCountries("login"), FULL_LIST);
    });

    // ------------------------------------------------------------ case 3
    console.log("3. per-workflow overrides NARROW only their workflow");
    await check("PHONE_LOGIN_COUNTRIES=IE narrows ONLY login; the others keep the full base", () => {
      setEnv({ PHONE_LOGIN_COUNTRIES: "IE" });
      assert.deepEqual(getSupportedPhoneCountries("login"), ["IE"]);
      assert.deepEqual(getSupportedPhoneCountries("verification"), FULL_LIST);
      assert.deepEqual(getSupportedPhoneCountries("change"), FULL_LIST);
    });
    await check("intersection semantics: an override code outside the base is dropped", () => {
      setEnv({ SUPPORTED_PHONE_COUNTRIES: "IE,GB", PHONE_LOGIN_COUNTRIES: "US,IE" });
      assert.deepEqual(getSupportedPhoneCountries("login"), ["IE"], "US is outside the base");
      assert.deepEqual(getSupportedPhoneCountries("change"), ["IE", "GB"], "base untouched");
    });
    await check("an override can never WIDEN beyond the base", () => {
      setEnv({ SUPPORTED_PHONE_COUNTRIES: "IE", PHONE_CHANGE_COUNTRIES: "IE,GB,US" });
      assert.deepEqual(getSupportedPhoneCountries("change"), ["IE"]);
    });
    await check("an override entirely outside the base is ignored (never an empty product)", () => {
      setEnv({ SUPPORTED_PHONE_COUNTRIES: "IE,GB", PHONE_VERIFICATION_COUNTRIES: "US,DE" });
      assert.deepEqual(getSupportedPhoneCountries("verification"), ["IE", "GB"]);
    });
    await check("each workflow reads exactly its own override; fresh read per call (no cache)", () => {
      setEnv({
        PHONE_LOGIN_COUNTRIES: "IE",
        PHONE_VERIFICATION_COUNTRIES: "IE,GB",
        PHONE_CHANGE_COUNTRIES: "IE,GB,US",
      });
      assert.deepEqual(getSupportedPhoneCountries("login"), ["IE"]);
      assert.deepEqual(getSupportedPhoneCountries("verification"), ["IE", "GB"]);
      assert.deepEqual(getSupportedPhoneCountries("change"), ["IE", "GB", "US"]);
      process.env.PHONE_LOGIN_COUNTRIES = "GB";
      assert.deepEqual(getSupportedPhoneCountries("login"), ["GB"], "no module-level cache");
      assert.deepEqual(getSupportedPhoneCountries("change"), ["IE", "GB", "US"], "change unmoved");
      assert.ok(getSupportedPhoneCountrySet("login").has("GB"), "set view agrees");
    });

    // ------------------------------------------------------------ case 4
    console.log("4. server authority - full default admits, explicit narrowing rejects");
    process.env.PHONE_LOGIN_ENABLED = "true";
    const userId = randomUUID();
    await db.user.create({
      data: { id: userId, email: `phone-countries-${RUN}@example.com` },
    });
    await check("full default: the change flow sends to a US number (spy provider - no SMS)", async () => {
      setEnv({});
      const spy = spyProvider();
      const sent = await sendPhoneVerification({
        user: sessionUser(userId),
        phone: NUMBERS.usChange,
        provider: spy.provider,
      });
      assert.equal(sent.kind, "sent", "US is supported by default now");
      assert.deepEqual(spy.calls, [{ method: "send", phoneE164: NUMBERS.usChange }]);
    });
    await check("full default: the login flow sends to a US number (spy client - no SMS)", async () => {
      setEnv({});
      const spy = spyClient();
      const sent = await sendPhoneLoginCode({ phone: NUMBERS.usLogin, client: spy.client });
      assert.equal(sent.kind, "sent", "US is supported by default now");
      assert.deepEqual(spy.calls, [{ method: "signInWithOtp" }]);
    });
    await check("SUPPORTED_PHONE_COUNTRIES=IE,GB: BOTH flows reject US pre-provider again", async () => {
      setEnv({ SUPPORTED_PHONE_COUNTRIES: "IE,GB" });
      const provider = spyProvider();
      const change = await sendPhoneVerification({
        user: sessionUser(userId),
        phone: NUMBERS.usChange,
        provider: provider.provider,
      });
      assert.equal(change.kind, "unsupported_country");
      const client = spyClient();
      const login = await sendPhoneLoginCode({ phone: NUMBERS.usLogin, client: client.client });
      assert.equal(login.kind, "unsupported_country");
      const verify = await verifyPhoneLoginCode({
        phone: NUMBERS.usLogin,
        code: "123456",
        client: client.client,
      });
      assert.equal(verify.kind, "unsupported_country");
      assert.equal(provider.calls.length, 0, "provider must never be reached - no SMS");
      assert.equal(client.calls.length, 0, "client must never be reached");
    });
    await check("PHONE_LOGIN_COUNTRIES=IE narrows the login flow ONLY (change keeps GB)", async () => {
      setEnv({ PHONE_LOGIN_COUNTRIES: "IE" });
      const client = spyClient();
      const login = await sendPhoneLoginCode({ phone: "+447400123456", client: client.client });
      assert.equal(login.kind, "unsupported_country", "GB rejected under the login override");
      assert.equal(client.calls.length, 0);
      assert.ok(
        getSupportedPhoneCountrySet("change").has("GB"),
        "the change flow's list is untouched by the login override",
      );
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
    console.log("6. one source of truth - pages and flows resolve from the SAME function");
    const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");
    await check("page prop source === flow validation source, per workflow", () => {
      const loginPage = read("app/(auth)/login/phone/page.tsx");
      const loginFlow = read("lib/auth/phone-login-flow.ts");
      const changePage = read("app/(auth)/auth/phone/page.tsx");
      const changeFlow = read("lib/auth/phone-flow.ts");
      for (const [name, source] of [
        ["login page", loginPage],
        ["login flow", loginFlow],
        ["change page", changePage],
        ["change flow", changeFlow],
      ] as const) {
        assert.ok(
          source.includes('from "@/lib/auth/phone-countries"'),
          `${name} imports the shared module`,
        );
      }
      assert.ok(loginPage.includes('getSupportedPhoneCountries("login")'), "login page prop");
      assert.ok(
        loginFlow.includes('getSupportedPhoneCountrySet("login")'),
        "login flow validates the same workflow",
      );
      assert.ok(changePage.includes('getSupportedPhoneCountries("change")'), "change page prop");
      assert.ok(
        changeFlow.includes('getSupportedPhoneCountrySet("change")'),
        "change flow validates the same workflow",
      );
      // And at runtime the set view IS the list view, per workflow.
      setEnv({ SUPPORTED_PHONE_COUNTRIES: "IE,GB,US", PHONE_LOGIN_COUNTRIES: "IE" });
      for (const kind of kinds) {
        assert.deepEqual(
          [...getSupportedPhoneCountrySet(kind)].sort(),
          [...getSupportedPhoneCountries(kind)].sort(),
          `${kind}: set === list`,
        );
      }
    });
    await check("no second country-env parser or country array exists in src/", () => {
      const envRead =
        /process\.env(?:\.|\[\s*["'`])(SUPPORTED_PHONE_COUNTRIES|PHONE_LOGIN_COUNTRIES|PHONE_VERIFICATION_COUNTRIES|PHONE_CHANGE_COUNTRIES)/;
      const offenders = srcFiles().filter(
        (file) => !file.endsWith(`lib${path.sep}auth${path.sep}phone-countries.ts`) &&
          envRead.test(readFileSync(file, "utf8")),
      );
      assert.deepEqual(offenders, [], "only phone-countries.ts may read the country envs");
      // The dynamic OVERRIDE_ENV[workflow] lookup is the one indirect read.
      assert.ok(
        read("lib/auth/phone-countries.ts").includes("process.env[OVERRIDE_ENV[workflow]]"),
        "the shared module reads the overrides through its own table",
      );
      const datasetBuilders = srcFiles().filter((file) =>
        readFileSync(file, "utf8").includes("getCountries("),
      );
      assert.deepEqual(
        datasetBuilders,
        [path.join(SRC, "lib", "auth", "countries.ts")],
        "only countries.ts builds a country array from libphonenumber",
      );
    });

    // ------------------------------------------------------------ case 7
    console.log("7. UI contract - Popular pinned + alphabetical rest over the full list");
    await check("the sheet's restricted filter covers every dataset country exactly once", () => {
      setEnv({});
      const isos = getSupportedPhoneCountries("login");
      // Exactly what CountryCodeSheet does in restricted mode.
      const allowed = new Set(isos.map((iso) => iso.toUpperCase()));
      const pinned = POPULAR_COUNTRIES.filter((c) => allowed.has(c.iso));
      const pinnedIsos = new Set(pinned.map((c) => c.iso as string));
      const rest = COUNTRIES.filter((c) => allowed.has(c.iso) && !pinnedIsos.has(c.iso));
      assert.equal(pinned.length, POPULAR_COUNTRIES.length, "every popular country available");
      assert.equal(pinned.length + rest.length, COUNTRIES.length, "one row per country, deduped");
      assert.equal(rest[0].iso, "AF", "the rest stays alphabetical (Afghanistan first)");
      // 245 flat rows - a plain list, virtualization deliberately not used.
      assert.ok(pinned.length + rest.length === 245 && 245 < 1000, "list size needs no virtualization");
    });
    await check("UI default country: IE preferred from the full list (both input steps)", () => {
      setEnv({});
      const isos = getSupportedPhoneCountries("login");
      const countries = isos.map((iso) => countryByIso(iso)!);
      const fallback = countries.find((c) => c.iso === "IE") ?? countries[0];
      assert.equal(fallback.iso, "IE");
    });
    await check("sheet search matches name AND dial code with or without '+'", () => {
      const ie = countryByIso("IE")!;
      const gb = countryByIso("GB")!;
      const de = countryByIso("DE")!;
      for (const q of ["353", "+353", "Ireland", "irela", "IE"]) {
        assert.ok(matchesCountry(ie, q), `IE should match "${q}"`);
      }
      for (const q of ["44", "+44", "United Kingdom", "united k"]) {
        assert.ok(matchesCountry(gb, q), `GB should match "${q}"`);
      }
      assert.ok(matchesCountry(de, "49"), "DE matches its dial code 49");
      assert.ok(!matchesCountry(ie, "44"), "IE must not match GB's dial code");
      assert.ok(!matchesCountry(gb, "Ireland"), "GB must not match Ireland");
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    await db.user
      .deleteMany({ where: { email: { contains: `phone-countries-${RUN}` } } })
      .catch(() => {});
    await db.authVerificationEvent
      .deleteMany({ where: { phoneE164: { in: [NUMBERS.usChange, NUMBERS.usLogin] } } })
      .catch(() => {});
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nTEST FAILURE:", error);
  process.exit(1);
});
