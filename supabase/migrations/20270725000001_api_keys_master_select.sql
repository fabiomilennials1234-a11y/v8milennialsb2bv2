-- Fix: master could create an API key but never see it again.
--
-- `api_keys` INSERT/UPDATE/DELETE policies all carry `is_master_user()`, but the
-- SELECT policy only checked `get_my_organization_ids()` (= team_members ∪ gestor
-- orgs — master is in neither). Net effect for a master operating inside a client
-- org: the INSERT succeeded and the row vanished on the very next read, so the
-- key list came back empty and the key looked like it had failed to be created.
--
-- Reproduced against prod before the fix (master 23b65a30…, 6 rows in the table):
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"23b65a30-…","role":"authenticated"}';
--   select is_master_user(), (select count(*) from api_keys);  -- => true, 0
--
-- Read-only widening: no new write path. `key_hash` is a hash, never the raw
-- secret, so a master reading this table still cannot recover an issued key.

DROP POLICY IF EXISTS "Org members can view own org api_keys" ON public.api_keys;

CREATE POLICY "Org members can view own org api_keys"
  ON public.api_keys
  FOR SELECT
  USING (
    (SELECT is_master_user())
    OR organization_id IN (SELECT get_my_organization_ids())
  );
