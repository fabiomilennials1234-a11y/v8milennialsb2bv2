-- =============================================================================
-- Migration: Enriquecer lead_history com metadata/source + triggers de pipe
-- Não quebra registros existentes — colunas opcionais com defaults.
-- Date: 2026-07-31
-- =============================================================================

-- 1. Adicionar colunas novas ao lead_history
ALTER TABLE public.lead_history
  ADD COLUMN IF NOT EXISTS metadata JSONB,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id UUID;

-- 2. Constraint de source (adicionar se não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_history_source_check'
  ) THEN
    ALTER TABLE public.lead_history
      ADD CONSTRAINT lead_history_source_check
      CHECK (source IN ('manual', 'agent', 'automation', 'system'));
  END IF;
END $$;

-- 3. Índice para queries por lead + source
CREATE INDEX IF NOT EXISTS idx_lead_history_lead_source
  ON public.lead_history (lead_id, source, created_at DESC);

-- 4. Trigger: pipe_whatsapp → log stage changes
CREATE OR REPLACE FUNCTION public.log_pipe_whatsapp_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.lead_history (lead_id, action, description, source, entity_type, entity_id, organization_id)
    VALUES (
      NEW.lead_id,
      'stage_changed',
      'Movido para ' || NEW.status || ' no funil WhatsApp',
      'system',
      'pipe_whatsapp',
      NEW.id,
      NEW.organization_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pipe_whatsapp_stage_change ON public.pipe_whatsapp;
CREATE TRIGGER trg_pipe_whatsapp_stage_change
  AFTER UPDATE OF status ON public.pipe_whatsapp
  FOR EACH ROW EXECUTE FUNCTION public.log_pipe_whatsapp_stage_change();

-- 5. Trigger: pipe_confirmacao → log stage changes
CREATE OR REPLACE FUNCTION public.log_pipe_confirmacao_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.lead_history (lead_id, action, description, source, entity_type, entity_id, organization_id)
    VALUES (
      NEW.lead_id,
      'stage_changed',
      'Movido para ' || NEW.status || ' no funil Confirmação',
      'system',
      'pipe_confirmacao',
      NEW.id,
      NEW.organization_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pipe_confirmacao_stage_change ON public.pipe_confirmacao;
CREATE TRIGGER trg_pipe_confirmacao_stage_change
  AFTER UPDATE OF status ON public.pipe_confirmacao
  FOR EACH ROW EXECUTE FUNCTION public.log_pipe_confirmacao_stage_change();

-- 6. Trigger: pipe_propostas → log stage changes
CREATE OR REPLACE FUNCTION public.log_pipe_propostas_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.lead_history (lead_id, action, description, source, entity_type, entity_id, organization_id)
    VALUES (
      NEW.lead_id,
      'stage_changed',
      'Movido para ' || NEW.status || ' no funil Propostas',
      'system',
      'pipe_propostas',
      NEW.id,
      NEW.organization_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pipe_propostas_stage_change ON public.pipe_propostas;
CREATE TRIGGER trg_pipe_propostas_stage_change
  AFTER UPDATE OF status ON public.pipe_propostas
  FOR EACH ROW EXECUTE FUNCTION public.log_pipe_propostas_stage_change();

-- 7. RLS: garantir que service_role pode inserir (para triggers e agent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'lead_history' AND policyname = 'service_role_insert_lead_history'
  ) THEN
    CREATE POLICY "service_role_insert_lead_history"
      ON public.lead_history
      FOR INSERT
      TO service_role
      WITH CHECK (true);
  END IF;
END $$;
