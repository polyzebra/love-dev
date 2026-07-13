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

REVOKE ALL ON FUNCTION public.realtime_can_join_conversation(text, uuid) FROM public;
REVOKE ALL ON FUNCTION public.realtime_can_join_conversation(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.realtime_can_join_conversation(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.realtime_can_join_conversation(text, uuid) TO supabase_realtime_admin;

DROP POLICY IF EXISTS "conversation participants receive broadcasts" ON realtime.messages;

CREATE POLICY "conversation participants receive broadcasts"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.messages.extension = 'broadcast'
  AND realtime.topic() LIKE 'conversation:%'
  AND public.realtime_can_join_conversation(realtime.topic(), (SELECT auth.uid()))
);
