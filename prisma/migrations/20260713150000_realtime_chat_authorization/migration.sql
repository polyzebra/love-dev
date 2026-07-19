-- Phase 0G: authorize Supabase Realtime PRIVATE channels for chat.
--
-- Browsers subscribe only to broadcast events on private channels named
-- `conversation:<id>`; the policy below is the ONLY thing that lets a
-- join succeed, and it admits exactly the conversation's participants
-- whose accounts are allowed to use chat. There is no postgres_changes
-- subscription anywhere - the database is never exposed to clients.
-- Writes stay on the API routes; service-role broadcasts bypass RLS.
--
-- The app tables carry RLS with NO policies (deny-all for anon/
-- authenticated - Prisma connects as postgres and bypasses RLS), so the
-- membership check runs in a SECURITY DEFINER function owned by
-- postgres. It is the narrowest possible aperture: boolean out, no row
-- data, EXECUTE granted to authenticated only, empty search_path.
--
-- L7.3.3 PORTABILITY: this migration must apply on ANY Postgres, including
-- one where Supabase Realtime is NOT provisioned (no `realtime` schema, no
-- `supabase_realtime_admin`/`anon` roles - e.g. the CI ephemeral database and
-- the production DB that raised P3018 SQLSTATE 3F000). The public helper always
-- installs; every Realtime-coupled object (roles + the realtime.messages
-- policy) is guarded so its absence is a NO-OP, never a failure. Idempotent:
-- CREATE OR REPLACE + IF-EXISTS guards make re-execution safe.

-- 1) The public membership helper - always safe to (re)install.
CREATE OR REPLACE FUNCTION public.realtime_can_join_conversation(topic text, uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT uid IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public."Participant" p
    JOIN public."User" u ON u.id = p."userId"
    WHERE p."conversationId" = split_part(topic, ':', 2)
      AND p."userId" = uid::text
      -- Same statuses that may use chat: suspended/banned/deleted
      -- accounts lose the live feed exactly like they lose the API.
      AND u.status IN ('ACTIVE', 'SHADOW_BANNED')
  );
$$;

-- PUBLIC always exists - revoke unconditionally.
REVOKE ALL ON FUNCTION public.realtime_can_join_conversation(text, uuid) FROM public;

-- 2) Role-scoped grants. `anon`, `authenticated` and `supabase_realtime_admin`
--    exist only on a Supabase-provisioned database; guard each so a plain
--    Postgres does not fail with "role does not exist".
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.realtime_can_join_conversation(text, uuid) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.realtime_can_join_conversation(text, uuid) TO authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_realtime_admin') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.realtime_can_join_conversation(text, uuid) TO supabase_realtime_admin';
  END IF;
END
$$;

-- 3) The realtime.messages RLS policy. PostgreSQL parses policy DDL against the
--    live catalog, so referencing a missing relation fails at PARSE time - it
--    must run via dynamic SQL, and only when BOTH the schema and the table
--    exist. Absent Realtime -> skipped (no-op). Present -> policy replaced.
DO $$
BEGIN
  IF to_regnamespace('realtime') IS NOT NULL
     AND to_regclass('realtime.messages') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "conversation participants receive broadcasts" ON realtime.messages';
    EXECUTE $policy$
      CREATE POLICY "conversation participants receive broadcasts"
      ON realtime.messages
      FOR SELECT
      TO authenticated
      USING (
        realtime.messages.extension = 'broadcast'
        AND realtime.topic() LIKE 'conversation:%'
        AND public.realtime_can_join_conversation(realtime.topic(), (SELECT auth.uid()))
      );
    $policy$;
  END IF;
END
$$;
