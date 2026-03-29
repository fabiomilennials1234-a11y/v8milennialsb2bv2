-- Fix competitions RLS to use get_user_organization_id() (supports Master user)
DROP POLICY IF EXISTS competitions_select ON competitions;
DROP POLICY IF EXISTS competitions_insert ON competitions;
DROP POLICY IF EXISTS competitions_update ON competitions;
DROP POLICY IF EXISTS competitions_delete ON competitions;
DROP POLICY IF EXISTS competitions_manage ON competitions;

CREATE POLICY competitions_select ON competitions FOR SELECT
  USING (organization_id = public.get_user_organization_id());
CREATE POLICY competitions_manage ON competitions FOR ALL
  USING (organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS competition_participants_select ON competition_participants;
DROP POLICY IF EXISTS competition_participants_insert ON competition_participants;
DROP POLICY IF EXISTS competition_participants_delete ON competition_participants;
DROP POLICY IF EXISTS competition_participants_manage ON competition_participants;

CREATE POLICY competition_participants_select ON competition_participants FOR SELECT
  USING (competition_id IN (SELECT id FROM competitions WHERE organization_id = public.get_user_organization_id()));
CREATE POLICY competition_participants_manage ON competition_participants FOR ALL
  USING (competition_id IN (SELECT id FROM competitions WHERE organization_id = public.get_user_organization_id()))
  WITH CHECK (competition_id IN (SELECT id FROM competitions WHERE organization_id = public.get_user_organization_id()));

DROP POLICY IF EXISTS competition_prizes_select ON competition_prizes;
DROP POLICY IF EXISTS competition_prizes_insert ON competition_prizes;
DROP POLICY IF EXISTS competition_prizes_update ON competition_prizes;
DROP POLICY IF EXISTS competition_prizes_delete ON competition_prizes;
DROP POLICY IF EXISTS competition_prizes_manage ON competition_prizes;

CREATE POLICY competition_prizes_select ON competition_prizes FOR SELECT
  USING (competition_id IN (SELECT id FROM competitions WHERE organization_id = public.get_user_organization_id()));
CREATE POLICY competition_prizes_manage ON competition_prizes FOR ALL
  USING (competition_id IN (SELECT id FROM competitions WHERE organization_id = public.get_user_organization_id()))
  WITH CHECK (competition_id IN (SELECT id FROM competitions WHERE organization_id = public.get_user_organization_id()));
