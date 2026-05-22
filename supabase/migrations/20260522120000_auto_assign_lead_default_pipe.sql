-- 20260522120000_auto_assign_lead_default_pipe.sql
--
-- Garante que TODO lead criado tenha pelo menos uma entrada em pipeline_entries.
-- Se nenhum caller (lead-webhook, UI manual, import, n8n) tiver inserido em
-- pipeline_entries ou custom_pipe_entries até o COMMIT da transação, o lead é
-- colocado automaticamente em `whatsapp/novo`.
--
-- A trigger é CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED — roda no
-- COMMIT, depois de qualquer INSERT em pipeline_entries que aconteça na mesma
-- transação. Isso evita duplicação quando o caller já cuidou do placement
-- (ex: lead-webhook com place_in_pipe).
--
-- Comportamento:
--   1. Se já existe row em pipeline_entries para o lead   → no-op
--   2. Se já existe row em custom_pipe_entries para lead  → no-op
--   3. Se org não tem pipeline system whatsapp ativo      → no-op (skip silencioso)
--   4. Se org não tem stage 'novo' ativo no whatsapp      → no-op (skip silencioso)
--   5. Caso contrário: INSERT pipeline_entries(stage_key='novo')
--
-- Não faz backfill — só novos leads a partir da migration.

-- =============================================================================
-- 1. Função SECURITY DEFINER
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_auto_assign_lead_default_pipe()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pipeline_id uuid;
  v_stage_exists boolean;
BEGIN
  -- (1) já está em pipeline_entries? skip
  IF EXISTS (
    SELECT 1 FROM public.pipeline_entries
    WHERE lead_id = NEW.id
    LIMIT 1
  ) THEN
    RETURN NULL;
  END IF;

  -- (2) já está em custom_pipe_entries? skip
  IF EXISTS (
    SELECT 1 FROM public.custom_pipe_entries
    WHERE lead_id = NEW.id
    LIMIT 1
  ) THEN
    RETURN NULL;
  END IF;

  -- (3) org tem pipeline system whatsapp ativo?
  SELECT id
    INTO v_pipeline_id
  FROM public.pipelines
  WHERE organization_id = NEW.organization_id
    AND type = 'system'
    AND slug = 'whatsapp'
    AND is_active = true
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- (4) stage 'novo' existe e está ativo nesse pipeline?
  SELECT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE organization_id = NEW.organization_id
      AND pipeline_type = 'whatsapp'
      AND stage_key = 'novo'
      AND is_active = true
  ) INTO v_stage_exists;

  IF NOT v_stage_exists THEN
    RETURN NULL;
  END IF;

  -- (5) cria entry whatsapp/novo
  INSERT INTO public.pipeline_entries (
    organization_id,
    pipeline_id,
    lead_id,
    stage_key,
    entered_at,
    stage_changed_at
  ) VALUES (
    NEW.organization_id,
    v_pipeline_id,
    NEW.id,
    'novo',
    NOW(),
    NOW()
  );

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.fn_auto_assign_lead_default_pipe() IS
  'Fallback que coloca lead órfão em whatsapp/novo no COMMIT da transação. '
  'Acionado por trg_auto_assign_lead_default_pipe (CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED). '
  'Multi-tenancy: usa NEW.organization_id exclusivamente, jamais cruza orgs.';

-- =============================================================================
-- 2. CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED
-- =============================================================================
-- Idempotente: drop antes do create para suportar re-aplicação.

DROP TRIGGER IF EXISTS trg_auto_assign_lead_default_pipe ON public.leads;

CREATE CONSTRAINT TRIGGER trg_auto_assign_lead_default_pipe
  AFTER INSERT ON public.leads
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_assign_lead_default_pipe();

COMMENT ON TRIGGER trg_auto_assign_lead_default_pipe ON public.leads IS
  'Garante que todo lead novo termine com pelo menos uma entry em pipeline_entries. '
  'DEFERRED: roda no COMMIT, depois de inserts explícitos em pipeline_entries/custom_pipe_entries '
  'feitos na mesma tx (ex: lead-webhook com place_in_pipe). Skip silencioso quando org não '
  'tem pipeline whatsapp ou stage novo configurado.';
