-- 20261220000000_ghost_stage_guard_pipe_insert.sql
--
-- GHOST-STAGE INGEST GUARD — camada 4 (chokepoint no INSERT das views pipe_*).
--
-- Incidente (2026-06-17, org "Dna de Almas"): lead "Flávia Luiza Barros Machado"
-- (origin='outro', phone=null) caiu em pipeline_entries.stage_key='novo' — etapa
-- DESATIVADA nessa org (migrada pro Funil B, 1ª etapa ativa = 'novo_lead'). Lead
-- ficou invisível no Kanban (usePipelineStages filtra is_active=true).
--
-- Causa raiz: as INSTEAD OF INSERT triggers das views compat pipe_whatsapp/
-- pipe_confirmacao/pipe_propostas gravavam `COALESCE(NEW.status, '<default>')`
-- direto em pipeline_entries.stage_key, SEM validar contra as etapas ATIVAS da
-- org. Todo writer que passa por essas views herdava o bug:
--   - RPC create_lead_with_pipe (chamada por webhook-new-lead com p_pipe_status='novo'
--     e webhook-confirmacao) — path que criou a Flávia.
--   - Frontend: useWhatsAppLeadIntegration (useLinkLeadToWhatsApp status:'novo'),
--     CreateOpportunityModal status:'novo', useCreatePipe* etc.
--
-- O guard de ingest existente (resolveActiveStageKey em _shared/pipeline-adapter.ts,
-- 2026-06-09) só cobria 5 call-sites de edge functions que escrevem em
-- pipeline_entries DIRETAMENTE — nunca os writers das views pipe_*.
--
-- Fix (raiz, defense-in-depth): novo helper SQL fn_resolve_active_stage_key()
-- espelha resolveActiveStageKey e é chamado dentro de cada pipe_*_insert_fn().
-- Resultado: NENHUM writer das views pode mais gravar stage inativo quando a org
-- tem etapa ativa. Coerção:
--   1. NEW.status casa com etapa ativa            → usa como veio
--   2. NEW.status inativo/null + org tem ativas    → 1ª etapa ativa (min position)
--   3. org sem nenhuma etapa ativa (não-seedada)   → COALESCE(NEW.status,'<default>')
--      (fallback estático atual — nunca derruba o lead)
--
-- UPDATE/DELETE das views NÃO mudam (move explícito de stage é intencional;
-- o usuário escolhe o destino e mover pra etapa inativa é caso de uso legítimo
-- de reorganização — fora do escopo deste guard, que protege só a CRIAÇÃO).

-- =============================================================================
-- 1. Helper: resolve stage_key alvo contra as etapas ATIVAS da org
-- =============================================================================
-- STABLE: só lê. SECURITY INVOKER: as INSTEAD OF triggers já rodam no contexto
-- do caller; manter invoker preserva RLS de pipeline_stages (a própria org).
-- search_path travado contra search-path attack.

CREATE OR REPLACE FUNCTION public.fn_resolve_active_stage_key(
  p_org_id          uuid,
  p_pipeline_type   text,
  p_requested       text,
  p_static_fallback text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_first_active text;
  v_requested_active boolean;
BEGIN
  -- (1) requested casa com etapa ativa?
  IF p_requested IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.pipeline_stages
      WHERE organization_id = p_org_id
        AND pipeline_type = p_pipeline_type
        AND stage_key = p_requested
        AND is_active = true
    ) INTO v_requested_active;

    IF v_requested_active THEN
      RETURN p_requested;
    END IF;
  END IF;

  -- (2) 1ª etapa ativa (menor position)
  SELECT stage_key
    INTO v_first_active
  FROM public.pipeline_stages
  WHERE organization_id = p_org_id
    AND pipeline_type = p_pipeline_type
    AND is_active = true
  ORDER BY position ASC
  LIMIT 1;

  IF v_first_active IS NOT NULL THEN
    RETURN v_first_active;
  END IF;

  -- (3) org sem etapas ativas (não-seedada) → fallback estático, nunca derruba o lead
  RETURN COALESCE(p_requested, p_static_fallback);
END;
$$;

COMMENT ON FUNCTION public.fn_resolve_active_stage_key(uuid, text, text, text) IS
  'Ghost-stage guard: coage um stage_key alvo para uma etapa ATIVA da org. '
  'Espelha resolveActiveStageKey (_shared/pipeline-adapter.ts). '
  '1) requested se ativo; 2) 1ª etapa ativa (min position); 3) COALESCE(requested, fallback estático).';

-- =============================================================================
-- 2. pipe_whatsapp — INSTEAD OF INSERT com guard
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pipe_whatsapp_insert_fn() RETURNS TRIGGER AS $$
DECLARE
  v_pipeline_id uuid;
  v_stage_key   text;
BEGIN
  SELECT id INTO v_pipeline_id
  FROM public.pipelines
  WHERE organization_id = NEW.organization_id
    AND slug = 'whatsapp' AND type = 'system'
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'Pipeline whatsapp not found for org %', NEW.organization_id;
  END IF;

  v_stage_key := public.fn_resolve_active_stage_key(
    NEW.organization_id, 'whatsapp', NEW.status, 'novo_lead'
  );

  INSERT INTO public.pipeline_entries
    (id, lead_id, organization_id, pipeline_id, stage_key, assigned_to, metadata, notes)
  VALUES (
    COALESCE(NEW.id, gen_random_uuid()),
    NEW.lead_id,
    NEW.organization_id,
    v_pipeline_id,
    v_stage_key,
    COALESCE(NEW.responsible_id, NEW.sdr_id),
    jsonb_build_object(
      'responsible_id', NEW.responsible_id,
      'sdr_id',         NEW.sdr_id,
      'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
      'sale_responsible_id', NEW.sale_responsible_id,
      'scheduled_date', NEW.scheduled_date
    ),
    NEW.notes
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- =============================================================================
-- 3. pipe_confirmacao — INSTEAD OF INSERT com guard
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pipe_confirmacao_insert_fn() RETURNS TRIGGER AS $$
DECLARE
  v_pipeline_id uuid;
  v_stage_key   text;
BEGIN
  SELECT id INTO v_pipeline_id
  FROM public.pipelines
  WHERE organization_id = NEW.organization_id
    AND slug = 'confirmacao' AND type = 'system'
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'Pipeline confirmacao not found for org %', NEW.organization_id;
  END IF;

  v_stage_key := public.fn_resolve_active_stage_key(
    NEW.organization_id, 'confirmacao', NEW.status, 'marcada'
  );

  INSERT INTO public.pipeline_entries
    (id, lead_id, organization_id, pipeline_id, stage_key, assigned_to, metadata, notes)
  VALUES (
    COALESCE(NEW.id, gen_random_uuid()),
    NEW.lead_id,
    NEW.organization_id,
    v_pipeline_id,
    v_stage_key,
    COALESCE(NEW.responsible_id, NEW.closer_id, NEW.sdr_id),
    jsonb_build_object(
      'meeting_date',     NEW.meeting_date,
      'is_confirmed',     COALESCE(NEW.is_confirmed, false),
      'closer_id',        NEW.closer_id,
      'responsible_id',   NEW.responsible_id,
      'sdr_id',           NEW.sdr_id,
      'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
      'sale_responsible_id', NEW.sale_responsible_id,
      'meet_link',        NEW.meet_link,
      'metrics_period_at', NEW.metrics_period_at
    ),
    NEW.notes
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- =============================================================================
-- 4. pipe_propostas — INSTEAD OF INSERT com guard
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pipe_propostas_insert_fn() RETURNS TRIGGER AS $$
DECLARE
  v_pipeline_id uuid;
  v_stage_key   text;
BEGIN
  SELECT id INTO v_pipeline_id
  FROM public.pipelines
  WHERE organization_id = NEW.organization_id
    AND slug = 'propostas' AND type = 'system'
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'Pipeline propostas not found for org %', NEW.organization_id;
  END IF;

  v_stage_key := public.fn_resolve_active_stage_key(
    NEW.organization_id, 'propostas', NEW.status, 'enviada'
  );

  INSERT INTO public.pipeline_entries
    (id, lead_id, organization_id, pipeline_id, stage_key, assigned_to, metadata, notes, closed_at)
  VALUES (
    COALESCE(NEW.id, gen_random_uuid()),
    NEW.lead_id,
    NEW.organization_id,
    v_pipeline_id,
    v_stage_key,
    COALESCE(NEW.responsible_id, NEW.closer_id),
    jsonb_build_object(
      'sale_value',       NEW.sale_value,
      'closer_id',        NEW.closer_id,
      'responsible_id',   NEW.responsible_id,
      'pre_sale_responsible_id', NEW.pre_sale_responsible_id,
      'sale_responsible_id', NEW.sale_responsible_id,
      'product_id',       NEW.product_id,
      'product_type',     NEW.product_type,
      'calor',            NEW.calor,
      'loss_reason',      NEW.loss_reason,
      'loss_reason_id',   NEW.loss_reason_id,
      'commitment_date',  NEW.commitment_date,
      'contract_duration', NEW.contract_duration,
      'metrics_period_at', NEW.metrics_period_at
    ),
    NEW.notes,
    NEW.closed_at
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- =============================================================================
-- 5. Validação
-- =============================================================================
-- Os triggers INSTEAD OF INSERT já existem (criados em 20260984000000) e apontam
-- para estas funções por nome — CREATE OR REPLACE FUNCTION os atualiza in-place,
-- sem precisar recriar os triggers.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'fn_resolve_active_stage_key'
  ) THEN
    RAISE EXCEPTION 'VALIDATION FAILED: fn_resolve_active_stage_key not created';
  END IF;
  RAISE NOTICE 'VALIDATION PASSED: ghost-stage guard wired into pipe_* insert fns';
END $$;
