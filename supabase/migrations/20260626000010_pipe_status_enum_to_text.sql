-- =============================================================================
-- Migration: Converter ENUM types de status para TEXT nas tabelas pipe_*
-- Motivo: Permitir etapas customizadas criadas por admins em pipeline_stages
-- Os ENUMs fixos impediam o uso de stage_keys customizados
-- =============================================================================

-- =====================
-- 0. Dropar triggers que referenciam 'UPDATE OF status' (bloqueiam ALTER TYPE)
-- Serão recriados após a conversão
-- =====================
DROP TRIGGER IF EXISTS trg_pipe_whatsapp_dispatch ON public.pipe_whatsapp;
DROP TRIGGER IF EXISTS trg_pipe_confirmacao_dispatch ON public.pipe_confirmacao;
DROP TRIGGER IF EXISTS trg_pipe_propostas_dispatch ON public.pipe_propostas;

-- =====================
-- 1. pipe_whatsapp.status: ENUM → TEXT
-- =====================
ALTER TABLE public.pipe_whatsapp
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.pipe_whatsapp
  ALTER COLUMN status TYPE TEXT USING status::TEXT;

ALTER TABLE public.pipe_whatsapp
  ALTER COLUMN status SET DEFAULT 'novo';

-- =====================
-- 2. pipe_confirmacao.status: ENUM → TEXT
-- =====================
ALTER TABLE public.pipe_confirmacao
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.pipe_confirmacao
  ALTER COLUMN status TYPE TEXT USING status::TEXT;

ALTER TABLE public.pipe_confirmacao
  ALTER COLUMN status SET DEFAULT 'reuniao_marcada';

-- =====================
-- 3. pipe_propostas.status: ENUM → TEXT
-- =====================
ALTER TABLE public.pipe_propostas
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.pipe_propostas
  ALTER COLUMN status TYPE TEXT USING status::TEXT;

ALTER TABLE public.pipe_propostas
  ALTER COLUMN status SET DEFAULT 'marcar_compromisso';

-- =====================
-- 4. leads.pipe_whatsapp: ENUM → TEXT
-- =====================
ALTER TABLE public.leads
  ALTER COLUMN pipe_whatsapp DROP DEFAULT;

ALTER TABLE public.leads
  ALTER COLUMN pipe_whatsapp TYPE TEXT USING pipe_whatsapp::TEXT;

ALTER TABLE public.leads
  ALTER COLUMN pipe_whatsapp SET DEFAULT 'novo';

-- =====================
-- 5. Remover os ENUM types (não são mais necessários)
-- =====================
DROP TYPE IF EXISTS public.pipe_whatsapp_status;
DROP TYPE IF EXISTS public.pipe_confirmacao_status;
DROP TYPE IF EXISTS public.pipe_propostas_status;

-- =====================
-- 6. Recriar triggers de dispatch (mesma definição original, agora sobre TEXT)
-- =====================
CREATE TRIGGER trg_pipe_whatsapp_dispatch
  AFTER INSERT OR UPDATE OF status ON public.pipe_whatsapp
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_pipe_dispatch_rules('whatsapp');

CREATE TRIGGER trg_pipe_confirmacao_dispatch
  AFTER INSERT OR UPDATE OF status ON public.pipe_confirmacao
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_pipe_dispatch_rules('confirmacao');

CREATE TRIGGER trg_pipe_propostas_dispatch
  AFTER INSERT OR UPDATE OF status ON public.pipe_propostas
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_pipe_dispatch_rules('propostas');

-- =====================
-- 7. Trigger de validação: garante que status é um stage_key válido em pipeline_stages
-- =====================
CREATE OR REPLACE FUNCTION public.validate_pipe_status()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
  v_pipe_type TEXT;
  v_stage_exists BOOLEAN;
BEGIN
  -- Se o status não mudou (UPDATE de outros campos), não revalidar
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Determinar pipeline_type pela tabela de origem
  v_pipe_type := CASE TG_TABLE_NAME
    WHEN 'pipe_whatsapp' THEN 'whatsapp'
    WHEN 'pipe_confirmacao' THEN 'confirmacao'
    WHEN 'pipe_propostas' THEN 'propostas'
  END;

  -- Buscar organization_id do lead
  SELECT organization_id INTO v_org_id
  FROM public.leads WHERE id = NEW.lead_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Lead % não encontrado ou sem organization_id', NEW.lead_id;
  END IF;

  -- Verificar se o stage_key existe e está ativo
  SELECT EXISTS(
    SELECT 1 FROM public.pipeline_stages
    WHERE organization_id = v_org_id
      AND pipeline_type = v_pipe_type
      AND stage_key = NEW.status
      AND is_active = true
  ) INTO v_stage_exists;

  IF NOT v_stage_exists THEN
    RAISE EXCEPTION 'Status "%" não é uma etapa válida para o pipeline "%" (org: %)',
      NEW.status, v_pipe_type, v_org_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger de validação nas 3 tabelas de pipe
CREATE TRIGGER trg_validate_pipe_whatsapp_status
  BEFORE INSERT OR UPDATE OF status ON public.pipe_whatsapp
  FOR EACH ROW EXECUTE FUNCTION public.validate_pipe_status();

CREATE TRIGGER trg_validate_pipe_confirmacao_status
  BEFORE INSERT OR UPDATE OF status ON public.pipe_confirmacao
  FOR EACH ROW EXECUTE FUNCTION public.validate_pipe_status();

CREATE TRIGGER trg_validate_pipe_propostas_status
  BEFORE INSERT OR UPDATE OF status ON public.pipe_propostas
  FOR EACH ROW EXECUTE FUNCTION public.validate_pipe_status();

-- =====================
-- Comentários atualizados
-- =====================
COMMENT ON COLUMN public.leads.pipe_whatsapp IS 'Estágio do lead no funil WhatsApp (TEXT dinâmico — validado contra pipeline_stages)';
COMMENT ON FUNCTION public.validate_pipe_status() IS 'Valida que status de pipe_* corresponde a uma etapa ativa em pipeline_stages';
