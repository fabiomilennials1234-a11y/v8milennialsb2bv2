-- ============================================================================
-- lead_comments RLS — master-ghost bypass + multi-org fix
--
-- BUG: "aba de comentários não funciona, ao enviar dá erro".
--
-- As políticas originais (20261023000000) usavam get_user_organization_id(),
-- que retorna APENAS a primeira org (ORDER BY created_at LIMIT 1) do usuário e
-- NÃO tem bypass master. Consequências:
--   1. Master abrindo lead de outra org → SELECT vazio + INSERT viola RLS
--      (organization_id do lead ≠ org do próprio team_member do master).
--   2. Usuário membro de 2+ orgs vendo lead da 2ª org → falha read+write.
--
-- A tabela `leads` já resolve isso via get_my_organization_ids() (SETOF, cobre
-- multi-org) + policy master_all_leads (is_master_user()). Espelhamos o mesmo
-- padrão aqui. author_user_id = auth.uid() é mantido em INSERT para integridade
-- de autoria (inclusive para master, que comenta com o próprio uid).
--
-- Idempotente. Helpers (get_my_organization_ids, is_master_user, is_user_admin)
-- são SECURITY DEFINER e já existem em prod (usados nas policies de leads).
-- ============================================================================

BEGIN;

-- ── SELECT ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "lead_comments_select_by_org" ON public.lead_comments;
CREATE POLICY "lead_comments_select_by_org"
  ON public.lead_comments FOR SELECT
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR (SELECT public.is_master_user())
  );

-- ── INSERT ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "lead_comments_insert_by_org" ON public.lead_comments;
CREATE POLICY "lead_comments_insert_by_org"
  ON public.lead_comments FOR INSERT
  WITH CHECK (
    author_user_id = auth.uid()
    AND (
      organization_id IN (SELECT public.get_my_organization_ids())
      OR (SELECT public.is_master_user())
    )
  );

-- ── UPDATE (edição do autor / soft-delete por admin / master) ───────────────
DROP POLICY IF EXISTS "lead_comments_update_by_author_or_admin" ON public.lead_comments;
CREATE POLICY "lead_comments_update_by_author_or_admin"
  ON public.lead_comments FOR UPDATE
  USING (
    (SELECT public.is_master_user())
    OR (
      organization_id IN (SELECT public.get_my_organization_ids())
      AND (
        author_user_id = auth.uid()
        OR (SELECT public.is_user_admin())
      )
    )
  )
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR (SELECT public.is_master_user())
  );

-- ── Verificação ────────────────────────────────────────────────────────────
DO $$
DECLARE v_pol int;
BEGIN
  SELECT count(*) INTO v_pol
  FROM pg_policies
  WHERE schemaname='public' AND tablename='lead_comments';
  IF v_pol < 3 THEN
    RAISE EXCEPTION 'FAIL: lead_comments policies missing (%/3)', v_pol;
  END IF;
  RAISE NOTICE 'VALIDATION PASSED: lead_comments RLS master+multi-org complete.';
END$$;

COMMIT;
