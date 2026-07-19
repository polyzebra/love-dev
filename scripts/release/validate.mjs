/**
 * Pure release-config validation - the fail-closed heart of the production
 * release gate (L7.3.7). No process.exit, no network, no filesystem, and it
 * NEVER returns or throws a value containing a password, token, or full
 * connection string. Callers (the release scripts) decide how to fail; the
 * unit tests (tests/release-gate.test.ts) drive this directly with fixtures.
 *
 * The two connection roles, kept distinct on purpose:
 *   - DATABASE_URL : runtime traffic       (Supabase transaction pooler :6543)
 *   - DIRECT_URL   : Prisma Migrate traffic (session/direct connection :5432)
 * Migrate must never run through the transaction pooler (no advisory locks /
 * session features - it hangs), so the gate proves DIRECT_URL is present and
 * sane before any migrate deploy.
 */

export class ReleaseConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseConfigError";
  }
}

const PLACEHOLDER_HOST = /localhost|127\.0\.0\.1|::1|example\.(com|org)|your-project/i;

/**
 * Parse a Postgres URL to non-secret identity only. Throws ReleaseConfigError
 * (with a redacted message) when absent/malformed. The returned object holds
 * NO password and NO raw URL - only fields safe to log.
 */
export function parsePgUrl(raw, label = "DATABASE_URL") {
  if (raw == null || String(raw).trim() === "") {
    throw new ReleaseConfigError(`${label} is missing`);
  }
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw new ReleaseConfigError(`${label} is malformed (not a valid URL)`);
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) {
    throw new ReleaseConfigError(`${label} is not a postgres:// URL`);
  }
  if (!u.hostname) {
    throw new ReleaseConfigError(`${label} has no host`);
  }
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  const user = decodeURIComponent(u.username || "");
  // Supabase pooler encodes the project ref in the user (postgres.<ref>);
  // a direct db.<ref>.supabase.co host encodes it in the hostname. Both are
  // NON-secret (the ref is public: <ref>.supabase.co).
  const refFromUser = (user.match(/^postgres\.([a-z0-9]{16,})$/) || [])[1] || null;
  const refFromHost = (u.hostname.match(/^db\.([a-z0-9]{16,})\.supabase\.co$/) || [])[1] || null;
  const schema = u.searchParams.get("schema") || "public";
  return {
    label,
    host: u.hostname,
    port: u.port || "5432",
    database,
    schema,
    projectRef: refFromUser || refFromHost || null,
    pooled: /pooler/.test(u.hostname) || u.searchParams.get("pgbouncer") === "true",
    isPlaceholder: PLACEHOLDER_HOST.test(u.hostname),
    /** The ONLY string safe to print: host suffix + db + schema, no user/pass. */
    redacted: `${redactHostSuffix(u.hostname)}:${u.port || "5432"}/${database}?schema=${schema}`,
  };
}

/** Log only the last labels of a host so the full host/project isn't emitted. */
export function redactHostSuffix(host) {
  if (!host) return "(none)";
  const parts = String(host).split(".");
  if (parts.length <= 2) return host;
  return "…." + parts.slice(-3).join(".");
}

/**
 * The migration-target contract (Phase D). Validates DIRECT_URL is a real,
 * production-suitable Postgres pointing at database `postgres`, schema
 * `public`, and - when DATABASE_URL is also given - that the two target the
 * SAME Supabase project. Returns the parsed identities (redacted-safe).
 *
 * @param {Record<string,string|undefined>} env
 * @param {{requireRuntime?: boolean, allowPlaceholder?: boolean}} [opts]
 */
export function assertReleaseTargets(env, opts = {}) {
  const { requireRuntime = true, allowPlaceholder = false } = opts;
  const direct = parsePgUrl(env.DIRECT_URL, "DIRECT_URL");

  const problems = [];
  if (direct.database !== "postgres") {
    problems.push(`DIRECT_URL database is '${direct.database}', expected 'postgres'`);
  }
  if (direct.schema !== "public") {
    problems.push(`DIRECT_URL schema is '${direct.schema}', expected 'public'`);
  }
  if (!allowPlaceholder && direct.isPlaceholder) {
    problems.push("DIRECT_URL points at a local/placeholder host - not a production target");
  }

  let runtime = null;
  if (requireRuntime || env.DATABASE_URL) {
    runtime = parsePgUrl(env.DATABASE_URL, "DATABASE_URL");
    if (runtime.database !== "postgres") {
      problems.push(`DATABASE_URL database is '${runtime.database}', expected 'postgres'`);
    }
    if (runtime.schema !== "public") {
      problems.push(`DATABASE_URL schema is '${runtime.schema}', expected 'public'`);
    }
    if (direct.projectRef && runtime.projectRef && direct.projectRef !== runtime.projectRef) {
      // Never print the refs themselves in case policy later deems them sensitive.
      problems.push("DATABASE_URL and DIRECT_URL target DIFFERENT Supabase projects");
    }
  }

  if (problems.length) {
    throw new ReleaseConfigError(problems.join("; "));
  }
  return {
    direct,
    runtime,
    sameProject: !runtime || direct.projectRef === runtime.projectRef,
  };
}
