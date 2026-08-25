-- ROLLBACK de 20270828000010_metrics_studio_panel_por_org.sql
--
-- Devolve o painel do Estúdio a UM POR MEMBRO.
--
-- ⚠️ NÃO RODE COM O FRONT NOVO NO AR. O front passou a ler o painel por
-- organização e a gravar `team_member_id` NULL quando quem edita é master.
-- Com a coluna de volta a NOT NULL, a gravação do master falha (23502) e a
-- leitura do membro devolve o painel de outra pessoa. Reverta o front PRIMEIRO.
--
-- ⚠️ E PERDE DADO: painel montado depois do apply é UM por org. Voltando à
-- unicidade por membro, aquela linha passa a pertencer a quem editou por
-- último — os demais membros ficam sem painel. Se `team_member_id` estiver
-- NULL (editado por master), a linha nem sobrevive ao NOT NULL: apague-a antes
-- ou escolha um membro para ela.

DELETE FROM public.metrics_studio_panels WHERE team_member_id IS NULL;

DROP POLICY IF EXISTS master_ghost_all_metrics_studio_panels ON public.metrics_studio_panels;
DROP POLICY IF EXISTS metrics_studio_panels_select ON public.metrics_studio_panels;
DROP POLICY IF EXISTS metrics_studio_panels_insert ON public.metrics_studio_panels;
DROP POLICY IF EXISTS metrics_studio_panels_update ON public.metrics_studio_panels;
DROP POLICY IF EXISTS metrics_studio_panels_delete ON public.metrics_studio_panels;

DROP INDEX IF EXISTS public.metrics_studio_panels_org_unico;

ALTER TABLE public.metrics_studio_panels
  ALTER COLUMN team_member_id SET NOT NULL;

ALTER TABLE public.metrics_studio_panels
  ADD CONSTRAINT metrics_studio_panels_unico_por_membro
  UNIQUE (organization_id, team_member_id);

CREATE INDEX IF NOT EXISTS idx_metrics_studio_panels_org_member
  ON public.metrics_studio_panels (organization_id, team_member_id);

-- Policies originais (20270811110000): dono lê e escreve o próprio painel.
CREATE POLICY metrics_studio_panels_select
  ON public.metrics_studio_panels FOR SELECT
  USING (organization_id IN (SELECT public.get_my_organization_ids())
     AND team_member_id IN (SELECT public.get_my_team_member_ids()));

CREATE POLICY metrics_studio_panels_insert
  ON public.metrics_studio_panels FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.get_my_organization_ids())
          AND team_member_id IN (SELECT public.get_my_team_member_ids()));

CREATE POLICY metrics_studio_panels_update
  ON public.metrics_studio_panels FOR UPDATE
  USING (organization_id IN (SELECT public.get_my_organization_ids())
     AND team_member_id IN (SELECT public.get_my_team_member_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_organization_ids())
          AND team_member_id IN (SELECT public.get_my_team_member_ids()));

CREATE POLICY metrics_studio_panels_delete
  ON public.metrics_studio_panels FOR DELETE
  USING (organization_id IN (SELECT public.get_my_organization_ids())
     AND team_member_id IN (SELECT public.get_my_team_member_ids()));
