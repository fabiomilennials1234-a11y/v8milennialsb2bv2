-- ============================================================================
-- Admin Reassign Credit RPCs — corrigir crédito atribuído errado pós-snapshot.
--
-- PRD #211 / Slice S2 (#213).
--
-- Background
-- ----------
-- O trigger `snapshot_responsible_from_lead` (migration 20261025000000) congela
-- `metadata.pre_sale_responsible_id` / `metadata.sale_responsible_id` em dois
-- eventos: INSERT do entry e transição final (compareceu / vendido). Depois
-- disso o snapshot é histórico imutável — mudar SDR ou closer no lead NÃO
-- atualiza retroativamente o crédito da reunião que já aconteceu.
--
-- Existe, porém, classe de erro operacional: admin descobre que crédito ficou
-- com a pessoa errada (ex.: SDR digitou nome de outro colega no avatar, lead
-- veio importado com responsável padrão errado, transferência interna que não
-- foi refletida a tempo). Sem RPC dedicada, o admin precisava editar
-- `metadata` direto no banco — sem auditoria, sem permission check, sem trace
-- no `lead_history`.
--
-- Decisão
-- -------
-- Duas RPCs simétricas, `SECURITY DEFINER`, com permission check inline
-- (admin/master da org dona do entry), com auditoria obrigatória em
-- `lead_history` (action='credit_reassigned'). Sem UI inicial — invocação via
-- `supabase.rpc()` em ferramenta de admin (console, script). UI fica para
-- issue futura quando demanda real aparecer.
--
--   1. admin_reassign_meeting_credit(p_entry_id, p_new_sdr_id, p_reason)
--        Atua sobre pipe `confirmacao`. Atualiza
--        `metadata.pre_sale_responsible_id` do entry alvo.
--        metric_type='meeting' na auditoria.
--
--   2. admin_reassign_sale_credit(p_entry_id, p_new_closer_id, p_reason)
--        Atua sobre pipe `propostas`. Atualiza
--        `metadata.sale_responsible_id` do entry alvo.
--        metric_type='sale' na auditoria.
--
-- Helper compartilhado:
--   public.is_org_admin_or_master(p_organization_id UUID) RETURNS BOOLEAN
--     Retorna TRUE se o caller (auth.uid()) é:
--       - master global (master_users.is_active=true), OU
--       - team_member ativo na org com role IN ('admin','master').
--
-- Validações (idênticas nas duas RPCs):
--   - `auth.uid()` não-nulo (autenticado).
--   - Entry existe.
--   - Caller é admin/master da org dona do entry → senão raise 'insufficient_privilege'.
--   - Entry pertence ao pipe esperado (slug=confirmacao para meeting,
--     slug=propostas para sale) — senão raise 'invalid_entry_pipe'.
--   - new_*_id pertence à mesma org do entry e está em team_members com
--     is_active=true → senão raise 'invalid_team_member'.
--   - p_reason não-nulo e não-vazio (após trim) → raise 'reason_required'.
--
-- Retorno (sucesso): jsonb
--   { "ok": true, "entry_id": <uuid>, "before": <uuid|null>, "after": <uuid>,
--     "metric_type": "meeting"|"sale" }
--
-- Apply scope
-- -----------
-- DEV only. Produção aguarda solicitação explícita.
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: Helper — is_org_admin_or_master
-- ============================================================================
-- STABLE function used by the two RPCs below. SECURITY DEFINER so it can see
-- master_users and team_members even when caller has restrictive RLS. Pure
-- read; performs no writes.

CREATE OR REPLACE FUNCTION public.is_org_admin_or_master(p_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.master_users
    WHERE user_id = auth.uid() AND is_active = TRUE
  )
  OR EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.user_id = auth.uid()
      AND tm.organization_id = p_organization_id
      AND tm.is_active = TRUE
      AND tm.role IN ('admin', 'master')
  );
$$;

COMMENT ON FUNCTION public.is_org_admin_or_master(UUID) IS
  'Returns TRUE if auth.uid() is a global active master OR an active '
  'team_member with role admin/master in the given organization. '
  'Introduced 2026-05-18 (PRD #211 / #213) for admin_reassign_*_credit RPCs.';

GRANT EXECUTE ON FUNCTION public.is_org_admin_or_master(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_admin_or_master(UUID) TO service_role;


-- ============================================================================
-- SECTION 2: admin_reassign_meeting_credit
-- ============================================================================
-- Reassigns metadata.pre_sale_responsible_id on a pipe_confirmacao entry.
-- Audits the change in lead_history with action='credit_reassigned'.

CREATE OR REPLACE FUNCTION public.admin_reassign_meeting_credit(
  p_entry_id UUID,
  p_new_sdr_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id UUID;
  v_entry_org_id  UUID;
  v_entry_lead_id UUID;
  v_pipeline_slug TEXT;
  v_pipeline_type TEXT;
  v_before        UUID;
  v_reason_clean  TEXT;
BEGIN
  -- 1. Authentication
  v_actor_user_id := auth.uid();
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  -- 2. Reason guard (do this early so a missing reason never reaches mutation)
  v_reason_clean := TRIM(COALESCE(p_reason, ''));
  IF v_reason_clean = '' THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;

  -- 3. Locate entry + resolve pipeline slug. Lock the entry row for the
  --    duration of the transaction to keep concurrent reassignments serialized.
  SELECT pe.organization_id, pe.lead_id, pip.slug, pip.type
    INTO v_entry_org_id, v_entry_lead_id, v_pipeline_slug, v_pipeline_type
  FROM public.pipeline_entries pe
  JOIN public.pipelines pip ON pip.id = pe.pipeline_id
  WHERE pe.id = p_entry_id
  FOR UPDATE OF pe;

  IF v_entry_org_id IS NULL THEN
    RAISE EXCEPTION 'entry_not_found' USING ERRCODE = '02000';
  END IF;

  -- 4. Pipe guard — meeting credit only meaningful on `confirmacao` system pipe
  IF v_pipeline_slug IS DISTINCT FROM 'confirmacao' OR v_pipeline_type IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'invalid_entry_pipe' USING ERRCODE = '22023';
  END IF;

  -- 5. Permission check — admin/master of the entry's org
  IF NOT public.is_org_admin_or_master(v_entry_org_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  -- 6. Target team_member must belong to the same org and be active
  IF NOT EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.id = p_new_sdr_id
      AND tm.organization_id = v_entry_org_id
      AND tm.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'invalid_team_member' USING ERRCODE = '23503';
  END IF;

  -- 7. Capture previous snapshot for audit trail
  SELECT NULLIF(pe.metadata->>'pre_sale_responsible_id', '')::uuid
    INTO v_before
  FROM public.pipeline_entries pe
  WHERE pe.id = p_entry_id;

  -- 8. Mutate metadata. jsonb_set with create_missing=true so the key is added
  --    if absent. We deliberately do NOT touch legacy keys (sdr_id, etc.) —
  --    cleanup is S3/#214.
  UPDATE public.pipeline_entries pe
  SET metadata = jsonb_set(
        COALESCE(pe.metadata, '{}'::jsonb),
        '{pre_sale_responsible_id}',
        to_jsonb(p_new_sdr_id::text),
        TRUE
      )
  WHERE pe.id = p_entry_id;

  -- 9. Audit in lead_history. action='credit_reassigned' is new (not in the
  --    constrained set of stage_changed/etc.), so we leave action free-form.
  --    lead_history has no CHECK on action.
  INSERT INTO public.lead_history (
    lead_id, organization_id, action, description, source, entity_type, entity_id, metadata, created_by
  ) VALUES (
    v_entry_lead_id,
    v_entry_org_id,
    'credit_reassigned',
    'Crédito de reunião reatribuído por admin',
    'manual',
    'pipeline_entry',
    p_entry_id,
    jsonb_build_object(
      'entry_id', p_entry_id,
      'metric_type', 'meeting',
      'before', v_before,
      'after', p_new_sdr_id,
      'reason', v_reason_clean,
      'actor_user_id', v_actor_user_id,
      'rpc', 'admin_reassign_meeting_credit',
      'rpc_version', '2026-05-18'
    ),
    v_actor_user_id
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'entry_id', p_entry_id,
    'metric_type', 'meeting',
    'before', v_before,
    'after', p_new_sdr_id
  );
END;
$$;

COMMENT ON FUNCTION public.admin_reassign_meeting_credit(UUID, UUID, TEXT) IS
  'Reassign metadata.pre_sale_responsible_id on a pipe_confirmacao entry with '
  'audit in lead_history (action=credit_reassigned, metric_type=meeting). '
  'Requires caller to be admin/master of the entry organization. '
  'Introduced 2026-05-18 (PRD #211 / #213).';

GRANT EXECUTE ON FUNCTION public.admin_reassign_meeting_credit(UUID, UUID, TEXT) TO authenticated;


-- ============================================================================
-- SECTION 3: admin_reassign_sale_credit
-- ============================================================================
-- Reassigns metadata.sale_responsible_id on a pipe_propostas entry.
-- Audits the change in lead_history with action='credit_reassigned'.

CREATE OR REPLACE FUNCTION public.admin_reassign_sale_credit(
  p_entry_id UUID,
  p_new_closer_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id UUID;
  v_entry_org_id  UUID;
  v_entry_lead_id UUID;
  v_pipeline_slug TEXT;
  v_pipeline_type TEXT;
  v_before        UUID;
  v_reason_clean  TEXT;
BEGIN
  v_actor_user_id := auth.uid();
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  v_reason_clean := TRIM(COALESCE(p_reason, ''));
  IF v_reason_clean = '' THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;

  SELECT pe.organization_id, pe.lead_id, pip.slug, pip.type
    INTO v_entry_org_id, v_entry_lead_id, v_pipeline_slug, v_pipeline_type
  FROM public.pipeline_entries pe
  JOIN public.pipelines pip ON pip.id = pe.pipeline_id
  WHERE pe.id = p_entry_id
  FOR UPDATE OF pe;

  IF v_entry_org_id IS NULL THEN
    RAISE EXCEPTION 'entry_not_found' USING ERRCODE = '02000';
  END IF;

  IF v_pipeline_slug IS DISTINCT FROM 'propostas' OR v_pipeline_type IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'invalid_entry_pipe' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_org_admin_or_master(v_entry_org_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.id = p_new_closer_id
      AND tm.organization_id = v_entry_org_id
      AND tm.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'invalid_team_member' USING ERRCODE = '23503';
  END IF;

  SELECT NULLIF(pe.metadata->>'sale_responsible_id', '')::uuid
    INTO v_before
  FROM public.pipeline_entries pe
  WHERE pe.id = p_entry_id;

  UPDATE public.pipeline_entries pe
  SET metadata = jsonb_set(
        COALESCE(pe.metadata, '{}'::jsonb),
        '{sale_responsible_id}',
        to_jsonb(p_new_closer_id::text),
        TRUE
      )
  WHERE pe.id = p_entry_id;

  INSERT INTO public.lead_history (
    lead_id, organization_id, action, description, source, entity_type, entity_id, metadata, created_by
  ) VALUES (
    v_entry_lead_id,
    v_entry_org_id,
    'credit_reassigned',
    'Crédito de venda reatribuído por admin',
    'manual',
    'pipeline_entry',
    p_entry_id,
    jsonb_build_object(
      'entry_id', p_entry_id,
      'metric_type', 'sale',
      'before', v_before,
      'after', p_new_closer_id,
      'reason', v_reason_clean,
      'actor_user_id', v_actor_user_id,
      'rpc', 'admin_reassign_sale_credit',
      'rpc_version', '2026-05-18'
    ),
    v_actor_user_id
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'entry_id', p_entry_id,
    'metric_type', 'sale',
    'before', v_before,
    'after', p_new_closer_id
  );
END;
$$;

COMMENT ON FUNCTION public.admin_reassign_sale_credit(UUID, UUID, TEXT) IS
  'Reassign metadata.sale_responsible_id on a pipe_propostas entry with '
  'audit in lead_history (action=credit_reassigned, metric_type=sale). '
  'Requires caller to be admin/master of the entry organization. '
  'Introduced 2026-05-18 (PRD #211 / #213).';

GRANT EXECUTE ON FUNCTION public.admin_reassign_sale_credit(UUID, UUID, TEXT) TO authenticated;


-- ============================================================================
-- SECTION 4: Validation
-- ============================================================================

DO $$
DECLARE
  v_fn_helper INT;
  v_fn_meet   INT;
  v_fn_sale   INT;
  v_meet_comment TEXT;
  v_sale_comment TEXT;
BEGIN
  SELECT COUNT(*) INTO v_fn_helper
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'is_org_admin_or_master';

  SELECT COUNT(*) INTO v_fn_meet
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'admin_reassign_meeting_credit';

  SELECT COUNT(*) INTO v_fn_sale
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'admin_reassign_sale_credit';

  SELECT obj_description('public.admin_reassign_meeting_credit(UUID, UUID, TEXT)'::regprocedure)
    INTO v_meet_comment;
  SELECT obj_description('public.admin_reassign_sale_credit(UUID, UUID, TEXT)'::regprocedure)
    INTO v_sale_comment;

  IF v_fn_helper = 0 THEN
    RAISE EXCEPTION 'FAIL: is_org_admin_or_master helper was not created.';
  END IF;
  IF v_fn_meet = 0 THEN
    RAISE EXCEPTION 'FAIL: admin_reassign_meeting_credit was not created.';
  END IF;
  IF v_fn_sale = 0 THEN
    RAISE EXCEPTION 'FAIL: admin_reassign_sale_credit was not created.';
  END IF;
  IF v_meet_comment IS NULL OR v_meet_comment NOT LIKE '%PRD #211 / #213%' THEN
    RAISE EXCEPTION 'FAIL: admin_reassign_meeting_credit comment not tagged with PRD reference.';
  END IF;
  IF v_sale_comment IS NULL OR v_sale_comment NOT LIKE '%PRD #211 / #213%' THEN
    RAISE EXCEPTION 'FAIL: admin_reassign_sale_credit comment not tagged with PRD reference.';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: admin reassign credit RPCs installed.';
END;
$$;

COMMIT;
