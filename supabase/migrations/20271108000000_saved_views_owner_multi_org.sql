-- Chamados a93206ea / 8e1c496e: dono obrigatório e acesso na org selecionada.
-- Reservada pela CLI em 06/10/2026 e renumerada após o teto verificado
-- da main e de produção (20271107170000). A versão inédita 20271106000020
-- colidiu com corrigir_venda_ganha na main; nenhuma migration aplicada mudou.
-- Escopo: saved_views apenas. Não aplicar a migration ampla de 39 tabelas
-- como dependência deste conserto. Compatível com clientes clássicos antigos.

ALTER TABLE public.saved_views ALTER COLUMN owner_id SET DEFAULT auth.uid();

DROP POLICY IF EXISTS saved_views_select ON public.saved_views;
CREATE POLICY saved_views_select ON public.saved_views
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND (owner_id = (SELECT auth.uid()) OR is_shared = true)
  );

DROP POLICY IF EXISTS saved_views_insert ON public.saved_views;
CREATE POLICY saved_views_insert ON public.saved_views
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND owner_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS saved_views_update ON public.saved_views;
CREATE POLICY saved_views_update ON public.saved_views
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND owner_id = (SELECT auth.uid())
  )
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND owner_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS saved_views_delete ON public.saved_views;
CREATE POLICY saved_views_delete ON public.saved_views
  FOR DELETE TO authenticated
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND owner_id = (SELECT auth.uid())
    AND is_system = false
  );

-- master_select_all_saved_views continua intacta: suporte pode ler,
-- mas esta mudança não dá a master uma nova permissão de escrita.
